import { z } from 'zod';

/**
 * Campo de contacto opcional. Cadena vacia se normaliza a `null`: el panel manda
 * "" cuando el usuario borra el dato, y guardar "" ensucia las comparaciones.
 */
const contactoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((valor) => (valor === '' ? null : valor))
    .nullable()
    .optional();

/** Igual que `contactoOpcional` pero validando formato de email cuando hay algo. */
const emailOpcional = z
  .string()
  .trim()
  .max(160)
  .refine(
    (valor) => valor === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor),
    'El email no tiene un formato válido'
  )
  .transform((valor) => (valor === '' ? null : valor))
  .nullable()
  .optional();

export const CreateComercioConLicenciaDTO = z.object({
  nombre: z
    .string({ message: 'El nombre del comercio debe ser una cadena de texto' })
    .trim()
    .min(2, 'El nombre del comercio debe tener al menos 2 caracteres'),
  /**
   * Plan que se le asigna al comercio en el alta. Opcional: sin `plan_id` el
   * comercio nace vacio y las licencias las emite despues la suscripcion.
   */
  plan_id: z.string({ message: 'plan_id debe ser una cadena de texto' }).trim().min(1).optional(),
  /** Datos de contacto opcionales: se pueden completar despues por el PUT. */
  telefono: contactoOpcional(40),
  email: emailOpcional,
  /**
   * Claves libres (comercio_id null) que se asignan al comercio en la misma
   * transaccion. El cupo del plan se valida sobre estas asignaciones.
   */
  licencia_ids: z
    .array(z.string({ message: 'Cada id de licencia debe ser una cadena de texto' }).trim().min(1))
    .max(50, 'No se pueden asignar más de 50 claves de una vez')
    .default([]),
  /**
   * Compatibilidad con quien quiera crear comercio y licencia de una sola vez
   * con una clave propia, sin pasar por el stock de claves sueltas.
   */
  licencia: z
    .object({
      clave: z
        .string({ message: 'La clave de licencia debe ser una cadena de texto' })
        .trim()
        .min(6, 'La clave de licencia debe tener al menos 6 caracteres'),
      rol: z.enum(['SERVIDOR', 'CLIENTE']).default('SERVIDOR'),
      max_activaciones: z
        .number({ message: 'max_activaciones debe ser un número entero' })
        .int()
        .positive('max_activaciones debe ser mayor a 0')
        .default(1),
      estado: z.string().default('activa'),
    })
    .optional(),
});

export type CreateComercioConLicenciaDTO = z.infer<typeof CreateComercioConLicenciaDTO>;

export const UpdateComercioDTO = z.object({
  nombre: z
    .string({ message: 'El nombre del comercio debe ser una cadena de texto' })
    .trim()
    .min(2, 'El nombre del comercio debe tener al menos 2 caracteres')
    .optional(),
  telefono: contactoOpcional(40),
  email: emailOpcional,
  chat_mensajes_override: z
    .number({ message: 'chat_mensajes_override debe ser un número' })
    .int()
    .min(0, 'chat_mensajes_override no puede ser negativo')
    .nullable()
    .optional(),
});

export type UpdateComercioDTO = z.infer<typeof UpdateComercioDTO>;

/**
 * Pago directo del comercio: el camino nuevo, sin Suscripcion de por medio.
 * `monto` es obligatorio (el panel lo prellena con el precio del plan, pero no
 * se asume: un pago parcial tambien es un pago). El periodo es opcional y por
 * defecto cubre el mes en curso.
 */
export const RegistrarPagoDirectoDTO = z.object({
  monto: z.coerce
    .number({ message: 'El monto debe ser un número' })
    .positive('El monto debe ser mayor a 0'),
  metodo: z
    .enum(['EFECTIVO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'TARJETA', 'OTRO'], {
      message: 'El método de pago no es válido',
    })
    .default('TRANSFERENCIA'),
  pagado_en: z.coerce.date().optional(),
  periodo_desde: z.coerce.date().optional(),
  periodo_hasta: z.coerce.date().optional(),
  nota: z.string().trim().max(500).nullable().optional(),
});

export type RegistrarPagoDirectoDTO = z.infer<typeof RegistrarPagoDirectoDTO>;
