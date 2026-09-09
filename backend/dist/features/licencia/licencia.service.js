import crypto from 'crypto';
import prisma from '../../config/prisma';
import { decrypt, encrypt, hmacBusqueda } from '../../utils/encryption';
import { verificarCupoDisponible } from './licencia.provision';
import { firmarTokenLicencia, VIGENCIA_TOKEN_SEGUNDOS } from './licencia.token';
/**
 * Busca una licencia por su clave en texto plano mediante el índice
 * determinista `clave_busqueda` (O(1)). Si no se encuentra por el índice
 * —fila vieja sin backfill—, hace fallback al escaneo decrypt de la tabla,
 * que desaparecerá cuando todas las filas tengan `clave_busqueda`.
 */
async function buscarPorClave(clave) {
    const hmac = hmacBusqueda(clave);
    const porIndice = await prisma.licencia.findUnique({
        where: { clave_busqueda: hmac },
        include: { comercio: { select: { id: true, nombre: true } } },
    });
    if (porIndice)
        return porIndice;
    // Fallback pre-backfill: escaneo. Con el volumen del panel no molesta;
    // dejarlo evita un error 404 fantasma si la fila aún no tiene índice.
    const todas = await prisma.licencia.findMany({
        include: { comercio: { select: { id: true, nombre: true } } },
    });
    for (const lic of todas) {
        try {
            if (decrypt(lic.clave_hash) === clave)
                return lic;
        }
        catch {
            continue;
        }
    }
    return null;
}
const CARACTERES_CLAVE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export class LicenciaService {
    async crear(data) {
        const comercio = await prisma.comercio.findUnique({
            where: { id: data.comercio_id },
        });
        if (!comercio) {
            const error = new Error('Comercio no encontrado');
            error.statusCode = 404;
            throw error;
        }
        // El cupo del plan manda: no se emiten licencias que el contrato no cubre.
        await verificarCupoDisponible(prisma, comercio.id, data.rol);
        let clave = (data.clave ?? '').trim();
        if (clave) {
            if (await this.claveEnUso(clave)) {
                const error = new Error('La clave ya está en uso por otra licencia');
                error.statusCode = 400;
                throw error;
            }
        }
        else {
            clave = await this.generarClaveUnica();
        }
        const licencia = await prisma.licencia.create({
            data: {
                comercio_id: comercio.id,
                clave_hash: encrypt(clave),
                clave_busqueda: hmacBusqueda(clave),
                rol: data.rol,
                estado: 'activa',
                max_activaciones: data.max_activaciones,
            },
            include: {
                comercio: {
                    select: { id: true, nombre: true },
                },
            },
        });
        return {
            message: 'Licencia emitida correctamente',
            licencia: {
                id: licencia.id,
                clave,
                rol: licencia.rol,
                estado: licencia.estado,
                max_activaciones: licencia.max_activaciones,
                comercio: licencia.comercio,
            },
        };
    }
    generarClave() {
        const aleatorio = (cantidad) => Array.from(crypto.randomBytes(cantidad))
            .map((byte) => CARACTERES_CLAVE[byte % CARACTERES_CLAVE.length])
            .join('');
        return `LIC-${new Date().getFullYear()}-${aleatorio(4)}-${aleatorio(4)}`;
    }
    async claveEnUso(clave) {
        const existe = await prisma.licencia.findUnique({
            where: { clave_busqueda: hmacBusqueda(clave) },
            select: { id: true },
        });
        if (existe)
            return true;
        // Fallback pre-backfill (mismo que buscarPorClave)
        const licencias = await prisma.licencia.findMany({ select: { clave_hash: true } });
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
    async generarClaveUnica() {
        for (let intento = 0; intento < 10; intento++) {
            const clave = this.generarClave();
            if (!(await this.claveEnUso(clave))) {
                return clave;
            }
        }
        throw new Error('No se pudo generar una clave única');
    }
    async activar(data) {
        const licenciaEncontrada = await buscarPorClave(data.clave);
        if (!licenciaEncontrada) {
            const error = new Error('Licencia no encontrada');
            error.statusCode = 404;
            throw error;
        }
        // Verificar si el estado de la licencia no es activa.
        // 403 (prohibido): el escritorio lo interpreta como suspensión/revocación y bloquea
        // localmente, aunque después quede sin conexión.
        if (licenciaEncontrada.estado !== 'activa') {
            const error = new Error(`La licencia no está disponible para activación (Estado: ${licenciaEncontrada.estado})`);
            error.statusCode = 403;
            throw error;
        }
        // Verificar si esta instalación ya estaba activada previamente
        const activacionExistente = await prisma.activacion.findUnique({
            where: {
                licencia_id_instalacion_id: {
                    licencia_id: licenciaEncontrada.id,
                    instalacion_id: data.instalacion_id,
                },
            },
        });
        if (activacionExistente) {
            await prisma.activacion.update({
                where: { id: activacionExistente.id },
                data: { ultima_validacion: new Date() },
            });
            return {
                message: 'Licencia re-validada con éxito para esta instalación',
                reinstalacion: true,
                token: this.firmarToken(licenciaEncontrada.id, data.instalacion_id, licenciaEncontrada.rol, licenciaEncontrada.comercio.id, licenciaEncontrada.comercio.nombre),
                licencia: {
                    id: licenciaEncontrada.id,
                    rol: licenciaEncontrada.rol,
                    estado: licenciaEncontrada.estado,
                    activado_en: licenciaEncontrada.activado_en,
                    max_activaciones_restantes: licenciaEncontrada.max_activaciones,
                    comercio: licenciaEncontrada.comercio,
                },
            };
        }
        // Nueva activación: verificar cupo disponible
        if (licenciaEncontrada.max_activaciones <= 0) {
            const error = new Error('La licencia ha alcanzado el límite máximo de activaciones permitidas');
            error.statusCode = 400;
            throw error;
        }
        const [licenciaActualizada] = await prisma.$transaction([
            prisma.licencia.update({
                where: { id: licenciaEncontrada.id },
                data: {
                    max_activaciones: {
                        decrement: 1,
                    },
                    activado_en: licenciaEncontrada.activado_en ?? new Date(),
                },
                include: {
                    comercio: {
                        select: {
                            id: true,
                            nombre: true,
                        },
                    },
                },
            }),
            prisma.activacion.create({
                data: {
                    licencia_id: licenciaEncontrada.id,
                    instalacion_id: data.instalacion_id,
                },
            }),
        ]);
        return {
            message: 'Licencia activada con éxito',
            reinstalacion: false,
            token: this.firmarToken(licenciaActualizada.id, data.instalacion_id, licenciaActualizada.rol, licenciaActualizada.comercio.id, licenciaActualizada.comercio.nombre),
            licencia: {
                id: licenciaActualizada.id,
                rol: licenciaActualizada.rol,
                estado: licenciaActualizada.estado,
                activado_en: licenciaActualizada.activado_en,
                max_activaciones_restantes: licenciaActualizada.max_activaciones,
                comercio: licenciaActualizada.comercio,
            },
        };
    }
    /**
     * Prueba firmada de que el servidor validó esta instalación ahora mismo.
     * El escritorio verifica la firma y computa la cadencia desde `validado_en`,
     * sin confiar en su base local.
     */
    firmarToken(licenciaId, instalacionId, rol, comercioId, comercioNombre) {
        const validadoEn = Math.floor(Date.now() / 1000);
        return firmarTokenLicencia({
            licencia_id: licenciaId,
            instalacion_id: instalacionId,
            rol,
            comercio_id: comercioId,
            comercio_nombre: comercioNombre,
            validado_en: validadoEn,
            vence_en: validadoEn + VIGENCIA_TOKEN_SEGUNDOS,
        });
    }
}
