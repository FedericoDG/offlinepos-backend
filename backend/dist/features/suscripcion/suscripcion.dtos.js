import { z } from 'zod';
export const CrearSuscripcionDTO = z.object({
    comercio_id: z.string({ message: 'El comercio es obligatorio' }).trim().min(1, 'El comercio es obligatorio'),
    plan_id: z.string({ message: 'El plan es obligatorio' }).trim().min(1, 'El plan es obligatorio'),
    ciclo: z.enum(['MENSUAL', 'ANUAL']).default('MENSUAL'),
    /** Si no viene, se toma la lista de precios del plan segun el ciclo. */
    precio_pactado: z.number({ message: 'El precio debe ser un número' }).nonnegative().optional(),
    /** Fecha de alta. Si no viene, hoy. */
    inicia_en: z.coerce.date().optional(),
    /** Si no viene, se calcula: inicia_en + 1 mes (o + 1 anio si el ciclo es ANUAL). */
    vence_en: z.coerce.date().optional(),
    nota: z.string().trim().max(500).optional(),
    /**
     * Contratar implica que el comercio pago: no se le emite el plan a alguien
     * que todavia no puso la plata. El pago del primer periodo se asienta solo;
     * estos campos son para decir como entro, no si entro.
     */
    metodo_pago: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'TARJETA', 'OTRO']).default('TRANSFERENCIA'),
    referencia_pago: z.string().trim().max(120).optional(),
    /** Fecha real del cobro. Si no viene, la de inicio de la suscripcion. */
    pagado_en: z.coerce.date().optional(),
});
export const ActualizarSuscripcionDTO = z.object({
    plan_id: z.string().trim().min(1).optional(),
    ciclo: z.enum(['MENSUAL', 'ANUAL']).optional(),
    precio_pactado: z.number().nonnegative().optional(),
    vence_en: z.coerce.date().optional(),
    estado: z.enum(['ACTIVA', 'EN_GRACIA', 'VENCIDA', 'CANCELADA']).optional(),
    nota: z.string().trim().max(500).nullable().optional(),
});
/**
 * Renovar corre el vencimiento un periodo hacia adelante. Si ademas entro la
 * plata, `registrar_pago` deja el Pago asociado en el mismo movimiento: es el
 * caso normal y evita que el panel tenga que hacer dos llamadas que pueden
 * quedar a medias.
 */
export const RenovarSuscripcionDTO = z.object({
    periodos: z.number().int().min(1, 'Debe renovar al menos un período').max(24).default(1),
    registrar_pago: z.boolean().default(false),
    monto: z.number().nonnegative().optional(),
    metodo: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'TARJETA', 'OTRO']).default('TRANSFERENCIA'),
    pagado_en: z.coerce.date().optional(),
    referencia: z.string().trim().max(120).optional(),
    nota: z.string().trim().max(500).optional(),
});
export const FiltroSuscripcionDTO = z.object({
    comercio_id: z.string().trim().min(1).optional(),
    plan_id: z.string().trim().min(1).optional(),
    estado: z.enum(['ACTIVA', 'EN_GRACIA', 'VENCIDA', 'CANCELADA']).optional(),
    /** Solo las que vencen dentro de N dias (incluye las ya vencidas). */
    vence_en_dias: z.coerce.number().int().min(0).max(365).optional(),
});
