import crypto from 'crypto';
import type { RolLicencia } from '@prisma/client';
import type { ClientePrisma } from '../../config/prisma.tipos';
import { decrypt, encrypt, hmacBusqueda } from '../../utils/encryption';
import { httpError } from '../../utils/api-error';

/**
 * Aprovisionamiento de licencias a partir del cupo del plan.
 *
 * La regla es una sola: las licencias activas de un comercio tienen que
 * coincidir con lo que declara su plan (`max_servidores`). Todo lo de abajo
 * existe para sostener esa igualdad cuando se contrata un plan o cuando se
 * cambia de plan, sin que nadie tenga que acordarse de emitir o dar de baja
 * claves a mano.
 *
 * Se trabaja siempre con el cliente de la transaccion que abre el llamador:
 * emitir licencias y crear la suscripcion tienen que pasar juntos o no pasar.
 */

const CARACTERES_CLAVE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Estado con el que se marca una licencia que el plan ya no cubre. */
export const ESTADO_FUERA_DE_PLAN = 'suspendida';

export interface LicenciaTocada {
  id: string;
  clave: string;
  rol: RolLicencia;
}

export interface AjusteLicencias {
  emitidas: LicenciaTocada[];
  reactivadas: LicenciaTocada[];
  suspendidas: LicenciaTocada[];
}

export const AJUSTE_VACIO: AjusteLicencias = { emitidas: [], reactivadas: [], suspendidas: [] };

export function huboAjuste(ajuste: AjusteLicencias): boolean {
  return ajuste.emitidas.length + ajuste.reactivadas.length + ajuste.suspendidas.length > 0;
}

export interface CupoPlan {
  max_servidores: number;
}

function generarClave(): string {
  const aleatorio = (cantidad: number): string =>
    Array.from(crypto.randomBytes(cantidad))
      .map((byte) => CARACTERES_CLAVE[byte % CARACTERES_CLAVE.length])
      .join('');

  return `LIC-${new Date().getFullYear()}-${aleatorio(4)}-${aleatorio(4)}`;
}

/**
 * Chequea unicidad por el índice `clave_busqueda` (O(1)), con fallback al
 * escaneo decrypt para filas viejas sin backfill —mismo patrón que el
 * servicio de licencias, a desaparecer cuando todas tengan índice.
 */
async function claveEnUso(tx: ClientePrisma, clave: string): Promise<boolean> {
  const existe = await tx.licencia.findUnique({
    where: { clave_busqueda: hmacBusqueda(clave) },
    select: { id: true },
  });
  if (existe) return true;

  const licencias = await tx.licencia.findMany({ select: { clave_hash: true } });
  for (const licencia of licencias) {
    try {
      if (decrypt(licencia.clave_hash) === clave) return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function generarClaveUnica(tx: ClientePrisma): Promise<string> {
  for (let intento = 0; intento < 10; intento++) {
    const clave = generarClave();
    if (!(await claveEnUso(tx, clave))) return clave;
  }

  throw new Error('No se pudo generar una clave de licencia unica');
}

function descifrarSeguro(cifrada: string): string {
  try {
    return decrypt(cifrada);
  } catch {
    return '(no descifrable)';
  }
}

/**
 * Deja las licencias del comercio en linea con el cupo de servidores del plan.
 *
 * Faltan licencias -> primero se reactivan las que se habian suspendido por un
 * cambio de plan anterior (asi el comercio recupera la clave que ya tenia
 * anotada en vez de recibir una nueva), y recien despues se emiten nuevas.
 *
 * Sobran licencias -> se suspenden, pero eligiendo con criterio: primero las
 * que nunca se activaron, y entre las activadas, las mas nuevas. Bajar de plan
 * tiene que apagar la caja que se sumo ultima, no la que el comercio viene
 * usando hace un año.
 */
export async function sincronizarLicenciasConPlan(
  tx: ClientePrisma,
  comercioId: string,
  plan: CupoPlan
): Promise<AjusteLicencias> {
  const ajuste: AjusteLicencias = { emitidas: [], reactivadas: [], suspendidas: [] };
  const rol: RolLicencia = 'SERVIDOR';
  const cupo = plan.max_servidores;

  const licencias = await tx.licencia.findMany({
    where: { comercio_id: comercioId },
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
          clave_busqueda: hmacBusqueda(clave),
          rol,
          estado: 'activa',
          // Una licencia habilita un puesto. Reinstalar la misma maquina no
          // consume cupo: el backend reconoce el instalacion_id.
          max_activaciones: 1,
        },
      });
      ajuste.emitidas.push({ id: creada.id, clave, rol });
    }
  } else if (activas.length > cupo) {
    const sobran = activas.length - cupo;

    const candidatas = [...activas].sort((a, b) => {
      const porUso = a.activaciones.length - b.activaciones.length;
      if (porUso !== 0) return porUso;
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

  return ajuste;
}

/** Cuenta las licencias activas del comercio, para mostrar el cupo usado. */
export async function contarLicenciasActivas(
  tx: ClientePrisma,
  comercioId: string
): Promise<{ servidores: number }> {
  const servidores = await tx.licencia.count({
    where: { comercio_id: comercioId, estado: 'activa' },
  });

  return { servidores };
}

/**
 * Resuelve el plan vigente de un comercio. Primero el plan asignado directo al
 * comercio (alta en un paso); si no tiene, cae al camino viejo de la
 * suscripcion no cancelada. Es la unica fuente de verdad del cupo, y la
 * comparten la emision suelta y la asignacion de claves.
 */
async function resolverPlan(
  tx: ClientePrisma,
  comercioId: string
): Promise<CupoPlan & { nombre: string }> {
  const comercio = await tx.comercio.findUnique({
    where: { id: comercioId },
    select: { plan: true },
  });

  let plan: CupoPlan & { nombre: string } | null = comercio?.plan ?? null;
  if (!plan) {
    const suscripcion = await tx.suscripcion.findFirst({
      where: { comercio_id: comercioId, estado: { not: 'CANCELADA' } },
      include: { plan: true },
    });

    if (!suscripcion) {
      throw httpError(
        'El comercio no tiene un plan contratado. Contratale un plan desde Suscripciones y las licencias se emiten solas.',
        409
      );
    }

    plan = suscripcion.plan;
  }

  return plan;
}

/**
 * Frena la emision manual de una licencia que el plan contratado no cubre.
 *
 * El cupo del plan es la unica fuente de verdad: si el comercio esta en Basico
 * no puede tener una segunda caja. La salida no es emitir igual, es venderle el
 * plan que corresponde — por eso el mensaje dice que hay que mejorar el plan y
 * no solo que no se puede.
 */
export async function verificarCupoDisponible(
  tx: ClientePrisma,
  comercioId: string
): Promise<void> {
  const plan = await resolverPlan(tx, comercioId);
  const cupo = plan.max_servidores;

  const activas = await tx.licencia.count({
    where: { comercio_id: comercioId, estado: 'activa' },
  });

  if (cupo === 0) {
    throw httpError(
      `El plan ${plan.nombre} no incluye licencias de servidor. Mejora el plan del comercio para habilitarlas.`,
      409
    );
  }

  if (activas >= cupo) {
    throw httpError(
      `El plan ${plan.nombre} cubre ${cupo} ${cupo === 1 ? 'servidor' : 'servidores'} y el comercio ya ${
        activas === 1 ? 'tiene 1 activa' : `tiene ${activas} activas`
      }. Mejora el plan para sumar otra.`,
      409
    );
  }
}

/** Cuantas claves se pretenden asignar a un comercio. */
export interface CupoAsignacion {
  servidores: number;
}

/**
 * Valida que asignar estas claves no supere el cupo de servidores del plan.
 *
 * A diferencia de `verificarCupoDisponible`, que frena la emision de a una, aca
 * el panel asigna varias claves sueltas en la misma operacion: la cuenta es
 * `asignadas + las que vienen` contra el cupo, y por eso no alcanza con mirar
 * si ya esta lleno. El cupo se controla al asignar y no al generar: una clave
 * libre todavia no pertenece a nadie, asi que no ocupa lugar.
 */
export async function validarCupoAsignacion(
  tx: ClientePrisma,
  comercioId: string,
  asignar: CupoAsignacion
): Promise<void> {
  const plan = await resolverPlan(tx, comercioId);
  const cupo = plan.max_servidores;
  const cantidad = asignar.servidores;
  if (cantidad <= 0) return;

  if (cupo === 0) {
    throw httpError(
      `El plan ${plan.nombre} no incluye licencias de servidor. Mejora el plan del comercio para habilitarlas.`,
      409
    );
  }

  const asignadas = await tx.licencia.count({
    where: { comercio_id: comercioId, estado: 'activa' },
  });

  if (asignadas + cantidad > cupo) {
    throw httpError(
      `El plan ${plan.nombre} cubre ${cupo} ${cupo === 1 ? 'servidor' : 'servidores'} y el comercio ya tiene ${asignadas} ${
        asignadas === 1 ? 'asignada' : 'asignadas'
      }. Estas queriendo sumar ${cantidad} mas. Mejora el plan para sumarlas.`,
      409
    );
  }
}
