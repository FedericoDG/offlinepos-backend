import { z } from 'zod';

export const MensajeHistorialDTO = z.object({
  rol: z.enum(['usuario', 'asistente', 'sistema']),
  contenido: z.string(),
});

export type MensajeHistorialDTO = z.infer<typeof MensajeHistorialDTO>;

export const ContextoNegocioDTO = z.object({
  usar_iva: z.boolean().optional(),
  alicuota_predeterminada: z
    .object({
      id: z.number(),
      porcentaje: z.number(),
      nombre: z.string(),
    })
    .optional(),
  alicuotas: z
    .array(
      z.object({
        id: z.number(),
        porcentaje: z.number(),
        nombre: z.string(),
        predeterminada: z.boolean(),
      })
    )
    .optional(),
});

export type ContextoNegocioDTO = z.infer<typeof ContextoNegocioDTO>;

export const PreguntarDTO = z.object({
  clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
  instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
  pregunta: z.string().trim().min(1, 'La pregunta es obligatoria').max(2000),
  id_conversacion: z.string().nullish(),
  historial: z.array(MensajeHistorialDTO).default([]),
  contexto: ContextoNegocioDTO.optional(),
});

export type PreguntarDTO = z.infer<typeof PreguntarDTO>;

export const ResultadoConsultaDTO = z.object({
  clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
  instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
  id_solicitud: z.string().trim().min(1, 'El id de solicitud es obligatorio'),
  sql: z.string().trim().min(1, 'El SQL es obligatorio'),
  filas: z.array(z.record(z.string(), z.unknown())),
  recortado: z.boolean().default(false),
  error: z.string().optional(),
});

export type ResultadoConsultaDTO = z.infer<typeof ResultadoConsultaDTO>;

export interface TokensUsadosDTO {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface UsoDTO {
  mensajes_usados: number;
  mensajes_limite: number;
}

export type RespuestaLLM =
  | { tipo: 'respuesta'; texto: string; tokens?: TokensUsadosDTO; uso?: UsoDTO }
  | { tipo: 'consulta'; id_solicitud: string; sql: string; descripcion: string; tokens?: TokensUsadosDTO; uso?: UsoDTO };
export const UsoConsultaDTO = z.object({
  clave: z.string().trim().min(1),
  instalacion_id: z.string().trim().min(1),
});

export type UsoConsultaDTO = z.infer<typeof UsoConsultaDTO>;

export const FacturaOcrRequestDTO = z.object({
  clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
  instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
  imagen_base64: z.string().min(1, 'La imagen en base64 es obligatoria'),
  mime_type: z.string().optional().default('image/jpeg'),
});

export type FacturaOcrRequestDTO = z.infer<typeof FacturaOcrRequestDTO>;

export interface FacturaOcrItemDTO {
  descripcion: string;
  codigo?: string | null;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  unidades_por_bulto?: number | null;
  descuento_porcentaje?: number | null;
  alicuota_iva?: number | null;
}

export interface FacturaOcrResultadoDTO {
  tipo_comprobante?: string | null;
  proveedor_nombre?: string | null;
  cuit?: string | null;
  numero_comprobante?: string | null;
  fecha?: string | null;
  items: FacturaOcrItemDTO[];
  subtotal_neto?: number | null;
  iva_total?: number | null;
  percepciones_total?: number | null;
  total: number;
}

export interface FacturaOcrResponseDTO {
  datos: FacturaOcrResultadoDTO;
  uso: UsoDTO & { mensajes_descontados: number };
}
