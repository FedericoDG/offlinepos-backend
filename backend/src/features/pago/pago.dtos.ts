import { z } from 'zod';

export const RegistrarPagoDTO = z.object({
  suscripcion_id: z.string({ message: 'La suscripción es obligatoria' }).trim().min(1, 'La suscripción es obligatoria'),
  monto: z.number({ message: 'El monto debe ser un número' }).positive('El monto debe ser mayor a 0'),
  moneda: z.string().trim().toUpperCase().length(3).optional(),
  metodo: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'TARJETA', 'OTRO']).default('TRANSFERENCIA'),
  pagado_en: z.coerce.date().optional(),
  periodo_desde: z.coerce.date(),
  periodo_hasta: z.coerce.date(),
  referencia: z.string().trim().max(120).optional(),
  nota: z.string().trim().max(500).optional(),
});

export type RegistrarPagoDTO = z.infer<typeof RegistrarPagoDTO>;

export const FiltroPagoDTO = z.object({
  suscripcion_id: z.string().trim().min(1).optional(),
  comercio_id: z.string().trim().min(1).optional(),
  /** Busca por nombre de comercio. */
  q: z.string().trim().max(120).optional(),
  metodo: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'TARJETA', 'OTRO']).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});

export type FiltroPagoDTO = z.infer<typeof FiltroPagoDTO>;
