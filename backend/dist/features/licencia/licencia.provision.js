import crypto from 'crypto';
import { decrypt, encrypt } from '../../utils/encryption';
import { httpError } from '../../utils/api-error';
/**
 * Aprovisionamiento de licencias a partir del cupo del plan.
 *
 * La regla es una sola: las licencias activas de un comercio tienen que
 * coincidir con lo que declara su plan (`max_servidores` y `max_clientes`).
 * Todo lo de abajo existe para sostener esa igualdad cuando se contrata un
 * plan o cuando se cambia de plan, sin que nadie tenga que acordarse de emitir
 * o dar de baja claves a mano.
 *
 * Se trabaja siempre con el cliente de la transaccion que abre el llamador:
 * emitir licencias y crear la suscripcion tienen que pasar juntos o no pasar.
 */
const CARACTERES_CLAVE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Estado con el que se marca una licencia que el plan ya no cubre. */
export const ESTADO_FUERA_DE_PLAN = 'suspendida';
export const AJUSTE_VACIO = { emitidas: [], reactivadas: [], suspendidas: [] };
export function huboAjuste(ajuste) {
    return ajuste.emitidas.length + ajuste.reactivadas.length + ajuste.suspendidas.length > 0;
}
function generarClave() {
    const aleatorio = (cantidad) => Array.from(crypto.randomBytes(cantidad))
        .map((byte) => CARACTERES_CLAVE[byte % CARACTERES_CLAVE.length])
        .join('');
    return `LIC-${new Date().getFullYear()}-${aleatorio(4)}-${aleatorio(4)}`;
}
/**
 * Las claves se guardan cifradas, no hasheadas, asi que no hay indice por el
 * que buscar: hay que descifrar y comparar. Es O(n) sobre la tabla, igual que
 * el resto del modulo de licencias. Con el volumen de un panel de comercios no
 * molesta; si algun dia molesta, la salida es el HMAC deterministico que el
 * .env ya tiene previsto como LOOKUP_SECRET.
 */
async function claveEnUso(tx, clave) {
    const licencias = await tx.licencia.findMany({ select: { clave_hash: true } });
    for (const licencia of licencias) {
        try {
            if (decrypt(licencia.clave_hash) === clave)
                return true;
        }
        catch {
            continue;
        }
    }
    return false;
}
async function generarClaveUnica(tx) {
    for (let intento = 0; intento < 10; intento++) {
        const clave = generarClave();
        if (!(await claveEnUso(tx, clave)))
            return clave;
    }
    throw new Error('No se pudo generar una clave de licencia unica');
}
function descifrarSeguro(cifrada) {
    try {
        return decrypt(cifrada);
    }
    catch {
        return '(no descifrable)';
    }
}
/**
 * Deja las licencias del comercio en linea con el cupo del plan, por rol.
 *
 * Faltan licencias -> primero se reactivan las que se habian suspendido por un
 * cambio de plan anterior (asi el comercio recupera la clave que ya tenia
 * anotada en vez de recibir una nueva), y recien despues se emiten nuevas.
 *
 * Sobran licencias -> se suspenden, pero eligiendo con criterio: primero las
 * que nunca se activaron, y entre las activadas, las mas nuevas. Bajar de Pro
 * a Basico tiene que apagar la terminal que se sumo ultima, no la caja que el
 * comercio viene usando hace un año.
 */
export async function sincronizarLicenciasConPlan(tx, comercioId, plan) {
    const ajuste = { emitidas: [], reactivadas: [], suspendidas: [] };
    const objetivos = [
        { rol: 'SERVIDOR', cupo: plan.max_servidores },
        { rol: 'CLIENTE', cupo: plan.max_clientes },
    ];
    for (const { rol, cupo } of objetivos) {
        const licencias = await tx.licencia.findMany({
            where: { comercio_id: comercioId, rol },
            include: { activaciones: { select: { id: true } } },
            orderBy: { createdAt: 'asc' },
        });
        const activas = licencias.filter((licencia) => licencia.estado === 'activa');
        if (activas.length < cupo) {
            let faltan = cupo - activas.length;
            const suspendidas = licencias.filter((licencia) => licencia.estado !== 'activa');
            for (const licencia of suspendidas.slice(0, faltan)) {
                await tx.licencia.update({ where: { id: licencia.id }, data: { estado: 'activa' } });
                ajuste.reactivadas.push({ id: licencia.id, clave: descifrarSeguro(licencia.clave_hash), rol });
                faltan -= 1;
            }
            for (let i = 0; i < faltan; i++) {
                const clave = await generarClaveUnica(tx);
                const creada = await tx.licencia.create({
                    data: {
                        comercio_id: comercioId,
                        clave_hash: encrypt(clave),
                        rol,
                        estado: 'activa',
                        // Una licencia habilita un puesto. Reinstalar la misma maquina no
                        // consume cupo: el backend reconoce el instalacion_id.
                        max_activaciones: 1,
                    },
                });
                ajuste.emitidas.push({ id: creada.id, clave, rol });
            }
        }
        else if (activas.length > cupo) {
            const sobran = activas.length - cupo;
            const candidatas = [...activas].sort((a, b) => {
                const porUso = a.activaciones.length - b.activaciones.length;
                if (porUso !== 0)
                    return porUso;
                return b.createdAt.getTime() - a.createdAt.getTime();
            });
            for (const licencia of candidatas.slice(0, sobran)) {
                await tx.licencia.update({
                    where: { id: licencia.id },
                    data: { estado: ESTADO_FUERA_DE_PLAN },
                });
                ajuste.suspendidas.push({ id: licencia.id, clave: descifrarSeguro(licencia.clave_hash), rol });
            }
        }
    }
    return ajuste;
}
/** Cuenta las licencias activas del comercio por rol, para mostrar el cupo usado. */
export async function contarLicenciasActivas(tx, comercioId) {
    const licencias = await tx.licencia.findMany({
        where: { comercio_id: comercioId, estado: 'activa' },
        select: { rol: true },
    });
    return {
        servidores: licencias.filter((l) => l.rol === 'SERVIDOR').length,
        clientes: licencias.filter((l) => l.rol === 'CLIENTE').length,
    };
}
/**
 * Frena la emision manual de una licencia que el plan contratado no cubre.
 *
 * El cupo del plan es la unica fuente de verdad: si el comercio esta en Basico
 * no puede tener terminales, y en Pro no puede tener una tercera. La salida no
 * es emitir igual, es venderle el plan que corresponde — por eso el mensaje
 * dice que hay que mejorar el plan y no solo que no se puede.
 */
export async function verificarCupoDisponible(tx, comercioId, rol) {
    const suscripcion = await tx.suscripcion.findFirst({
        where: { comercio_id: comercioId, estado: { not: 'CANCELADA' } },
        include: { plan: true },
    });
    if (!suscripcion) {
        throw httpError('El comercio no tiene un plan contratado. Contratale un plan desde Suscripciones y las licencias se emiten solas.', 409);
    }
    const plan = suscripcion.plan;
    const esServidor = rol === 'SERVIDOR';
    const cupo = esServidor ? plan.max_servidores : plan.max_clientes;
    const etiqueta = esServidor ? 'servidor' : 'cliente';
    const plural = esServidor ? 'servidores' : 'clientes';
    const activas = await tx.licencia.count({
        where: { comercio_id: comercioId, rol, estado: 'activa' },
    });
    if (cupo === 0) {
        throw httpError(`El plan ${plan.nombre} no incluye licencias de ${etiqueta}. Mejora el plan del comercio para habilitarlas.`, 409);
    }
    if (activas >= cupo) {
        throw httpError(`El plan ${plan.nombre} cubre ${cupo} ${cupo === 1 ? etiqueta : plural} y el comercio ya ${activas === 1 ? 'tiene 1 activa' : `tiene ${activas} activas`}. Mejora el plan para sumar otra.`, 409);
    }
}
