import { z } from 'zod';

/**
 * Un plan es lo que se vende. El cupo que declara es el de licencias servidor
 * (la caja). Los cupos son editables porque manana puede aparecer otro; lo que
 * no es editable es el `codigo`, que es la referencia estable del plan.
 */
export const CrearPlanDTO = z.object({
  codigo: z
    .string({ message: 'El código del plan debe ser una cadena de texto' })
    .trim()
    .toUpperCase()
    .min(2, 'El código debe tener al menos 2 caracteres')
    .max(30, 'El código no puede superar los 30 caracteres')
    .regex(/^[A-Z0-9_]+$/, 'El código solo admite letras mayúsculas, números y guion bajo'),
  nombre: z
    .string({ message: 'El nombre del plan debe ser una cadena de texto' })
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres'),
  descripcion: z
    .string()
    .trim()
    .max(500, 'La descripción no puede superar los 500 caracteres')
    .nullable()
    .optional(),
  precio_mensual: z
    .number({ message: 'El precio mensual debe ser un número' })
    .nonnegative('El precio mensual no puede ser negativo'),
  precio_anual: z
    .number({ message: 'El precio anual debe ser un número' })
    .nonnegative('El precio anual no puede ser negativo')
    .optional()
    .nullable(),
  moneda: z.string().trim().toUpperCase().length(3, 'La moneda debe ser un código de 3 letras').default('ARS'),
  max_servidores: z
    .number({ message: 'max_servidores debe ser un número entero' })
    .int()
    .min(0, 'max_servidores no puede ser negativo')
    .max(50, 'max_servidores no puede superar 50')
    .default(1),
  chat_mensajes_mes: z
    .number({ message: 'chat_mensajes_mes debe ser un número entero' })
    .int()
    .min(0, 'chat_mensajes_mes no puede ser negativo')
    .default(400)
    .describe('Mensajes mensuales del chat. 0 = ilimitado.'),
  activo: z.boolean().default(true),
});

export type CrearPlanDTO = z.infer<typeof CrearPlanDTO>;

/** El codigo queda fuera: cambiarlo romperia las referencias del panel. */
export const ActualizarPlanDTO = CrearPlanDTO.omit({ codigo: true }).partial();

export type ActualizarPlanDTO = z.infer<typeof ActualizarPlanDTO>;

export interface PlanDTO {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  precio_mensual: number;
  precio_anual: number | null;
  moneda: string;
  max_servidores: number;
  chat_mensajes_mes: number;
  activo: boolean;
  /** Comercios que hoy tienen este plan asignado directo (Comercio.plan_id). */
  comercios_con_plan: number;
  /** @deprecated el alta nueva asigna Comercio.plan_id: usar comercios_con_plan. */
  suscripciones_activas: number;
  createdAt: Date;
  updatedAt: Date;
}
