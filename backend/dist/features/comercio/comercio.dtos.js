import { z } from 'zod';
export const CreateComercioConLicenciaDTO = z.object({
    nombre: z
        .string({ message: 'El nombre del comercio debe ser una cadena de texto' })
        .trim()
        .min(2, 'El nombre del comercio debe tener al menos 2 caracteres'),
    licencia: z.object({
        clave: z
            .string({ message: 'La clave de licencia debe ser una cadena de texto' })
            .trim()
            .min(6, 'La clave de licencia debe tener al menos 6 caracteres'),
        max_activaciones: z
            .number({ message: 'max_activaciones debe ser un número entero' })
            .int()
            .positive('max_activaciones debe ser mayor a 0')
            .default(1),
        estado: z.string().default('activa'),
    }),
});
export const UpdateComercioDTO = z.object({
    nombre: z
        .string({ message: 'El nombre del comercio debe ser una cadena de texto' })
        .trim()
        .min(2, 'El nombre del comercio debe tener al menos 2 caracteres')
        .optional(),
});
