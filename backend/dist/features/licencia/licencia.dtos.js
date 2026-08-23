import { z } from 'zod';
export const ActivarLicenciaDTO = z.object({
    clave: z
        .string({ message: 'La clave de licencia debe ser una cadena de texto' })
        .trim()
        .min(1, 'La clave de licencia es obligatoria'),
    instalacion_id: z
        .string({ message: 'El identificador de instalación es obligatorio' })
        .trim()
        .min(1, 'El identificador de instalación es obligatorio'),
});
export const CrearLicenciaDTO = z.object({
    comercio_id: z
        .string({ message: 'El comercio es obligatorio' })
        .trim()
        .min(1, 'El comercio es obligatorio'),
    rol: z.enum(['SERVIDOR', 'CLIENTE']).default('SERVIDOR'),
    max_activaciones: z
        .number({ message: 'max_activaciones debe ser un número entero' })
        .int()
        .positive('max_activaciones debe ser mayor a 0')
        .max(1000, 'max_activaciones no puede superar 1000')
        .default(1),
    clave: z
        .string({ message: 'La clave debe ser una cadena de texto' })
        .trim()
        .min(6, 'La clave debe tener al menos 6 caracteres')
        .optional(),
});
