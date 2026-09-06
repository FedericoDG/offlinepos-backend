import { z } from 'zod';
export const MensajeHistorialDTO = z.object({
    rol: z.enum(['usuario', 'asistente', 'sistema']),
    contenido: z.string(),
});
export const PreguntarDTO = z.object({
    clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
    instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
    pregunta: z.string().trim().min(1, 'La pregunta es obligatoria').max(2000),
    id_conversacion: z.string().optional(),
    historial: z.array(MensajeHistorialDTO).default([]),
});
export const ResultadoConsultaDTO = z.object({
    clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
    instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
    id_solicitud: z.string().trim().min(1, 'El id de solicitud es obligatorio'),
    sql: z.string().trim().min(1, 'El SQL es obligatorio'),
    filas: z.array(z.record(z.string(), z.unknown())),
    recortado: z.boolean().default(false),
    error: z.string().optional(),
});
