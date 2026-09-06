import { z } from 'zod';
import prisma from '../../config/prisma';
import { decrypt } from '../../utils/encryption';
import { httpError } from '../../utils/api-error';
/**
 * API de licencias para el panel: consultar el listado y administrar las
 * instalaciones activadas.
 *
 * Vive aparte de `licencia.service.ts` a proposito: ese archivo es el camino
 * que usa el POS para activar, y no se toca.
 *
 * La paginacion es del servidor: con cientos de licencias emitidas, traerlas
 * todas y filtrar en el navegador deja de ser una opcion mucho antes de lo que
 * uno cree.
 */
export const FiltroLicenciaDTO = z.object({
    /** Busca por nombre de comercio, sin distinguir mayusculas ni acentos de mas. */
    q: z.string().trim().max(120).optional(),
    comercio_id: z.string().trim().min(1).optional(),
    rol: z.enum(['SERVIDOR', 'CLIENTE']).optional(),
    estado: z.string().trim().min(1).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    limite: z.coerce.number().int().min(1).max(100).default(20),
});
export class LicenciaPanelService {
    db;
    /**
     * El cliente de base entra por constructor para poder ejercitar este
     * servicio con datos controlados, sin Postgres. En produccion nadie pasa
     * nada y usa el cliente real.
     */
    constructor(db = prisma) {
        this.db = db;
    }
    async listar(filtro) {
        const where = {};
        if (filtro.comercio_id)
            where.comercio_id = filtro.comercio_id;
        if (filtro.rol)
            where.rol = filtro.rol;
        if (filtro.estado)
            where.estado = filtro.estado;
        if (filtro.q) {
            where.comercio = { nombre: { contains: filtro.q, mode: 'insensitive' } };
        }
        // El total se cuenta con el mismo `where` que la pagina: si no, el
        // paginador miente en cuanto alguien escribe algo en el buscador.
        const [total, licencias] = await Promise.all([
            this.db.licencia.count({ where }),
            this.db.licencia.findMany({
                where,
                include: {
                    comercio: { select: { id: true, nombre: true } },
                    activaciones: {
                        select: { id: true, instalacion_id: true, ultima_validacion: true },
                        orderBy: { ultima_validacion: 'desc' },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip: (filtro.pagina - 1) * filtro.limite,
                take: filtro.limite,
            }),
        ]);
        const datos = licencias.map((licencia) => ({
            id: licencia.id,
            clave_original: this.descifrarSeguro(licencia.clave_hash),
            rol: licencia.rol,
            estado: licencia.estado,
            max_activaciones: licencia.max_activaciones,
            activado_en: licencia.activado_en,
            activaciones: licencia.activaciones,
            comercio: licencia.comercio,
            createdAt: licencia.createdAt,
            updatedAt: licencia.updatedAt,
        }));
        return {
            datos,
            total,
            pagina: filtro.pagina,
            limite: filtro.limite,
            paginas: Math.max(1, Math.ceil(total / filtro.limite)),
        };
    }
    /**
     * Libera la instalacion de una licencia y le devuelve el cupo de activacion.
     *
     * Es la respuesta al caso mas comun de soporte: el comercio cambio de PC. La
     * clave sigue siendo la misma y el cupo del plan no se mueve — lo unico que
     * pasa es que el puesto queda libre para que lo tome la maquina nueva.
     *
     * Emitir una licencia de reemplazo seria la salida equivocada: dejaria al
     * comercio con dos licencias activas para un plan que cubre una sola.
     */
    async liberarActivacion(licenciaId, activacionId) {
        return this.db.$transaction(async (tx) => {
            const activacion = await tx.activacion.findUnique({ where: { id: activacionId } });
            // Se comprueba la pertenencia y no solo la existencia: con solo el id
            // suelto se podria liberar la instalacion de otra licencia.
            if (!activacion || activacion.licencia_id !== licenciaId) {
                throw httpError('La activacion no existe o no pertenece a esta licencia', 404);
            }
            await tx.activacion.delete({ where: { id: activacionId } });
            // El cupo vuelve al pozo. `max_activaciones` cuenta las que quedan, asi
            // que devolver una es exactamente deshacer lo que hizo la activacion.
            const licencia = await tx.licencia.update({
                where: { id: licenciaId },
                data: { max_activaciones: { increment: 1 } },
                include: {
                    comercio: { select: { id: true, nombre: true } },
                    activaciones: { select: { id: true } },
                },
            });
            return {
                message: 'Instalacion liberada. El comercio ya puede activar la misma clave en la maquina nueva.',
                licencia: {
                    id: licencia.id,
                    comercio: licencia.comercio,
                    max_activaciones: licencia.max_activaciones,
                    activaciones_restantes: licencia.activaciones.length,
                },
            };
        });
    }
    descifrarSeguro(cifrada) {
        try {
            return decrypt(cifrada);
        }
        catch {
            return null;
        }
    }
}
