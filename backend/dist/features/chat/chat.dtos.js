import { z } from 'zod';
export const MensajeHistorialDTO = z.object({
    rol: z.enum(['usuario', 'asistente', 'sistema']),
    contenido: z.string(),
});
export const ContextoNegocioDTO = z
    .object({
    usar_iva: z.boolean().optional(),
    alicuota_predeterminada: z
        .object({
        id: z.number(),
        porcentaje: z.number(),
        nombre: z.string(),
    })
        .optional(),
    alicuotas: z
        .array(z.object({
        id: z.number(),
        porcentaje: z.number(),
        nombre: z.string(),
        predeterminada: z.boolean(),
    }))
        .optional(),
    fecha_actual: z.string().optional(),
    hora_actual: z.string().optional(),
    dia_semana: z.string().optional(),
    timestamp_actual: z.number().optional(),
    modulo_recordatorios: z.boolean().optional(),
    modulo_gastos: z.boolean().optional(),
    modulos_activos: z.record(z.string(), z.boolean()).optional(),
    capacidades_interactivas: z.record(z.string(), z.string()).optional(),
    categorias_gasto: z
        .array(z.object({
        id: z.number(),
        nombre: z.string(),
    }))
        .optional(),
    tablas_sistema: z.array(z.string()).optional(),
})
    .passthrough();
export const PreguntarDTO = z.object({
    clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
    instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
    pregunta: z.string().trim().min(1, 'La pregunta es obligatoria').max(2000),
    id_conversacion: z.string().nullish(),
    historial: z.array(MensajeHistorialDTO).default([]),
    contexto: ContextoNegocioDTO.optional(),
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
export const UsoConsultaDTO = z.object({
    clave: z.string().trim().min(1),
    instalacion_id: z.string().trim().min(1),
});
export const FacturaOcrRequestDTO = z.object({
    clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
    instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
    imagen_base64: z.string().min(1, 'La imagen en base64 es obligatoria'),
    mime_type: z.string().optional().default('image/jpeg'),
});
