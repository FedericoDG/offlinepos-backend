import { z } from 'zod';

export const MensajeHistorialDTO = z.object({
  rol: z.enum(['usuario', 'asistente', 'sistema']),
  contenido: z.string(),
});

export type MensajeHistorialDTO = z.infer<typeof MensajeHistorialDTO>;

export const PreguntarDTO = z.object({
  clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
  instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
  pregunta: z.string().trim().min(1, 'La pregunta es obligatoria').max(2000),
  id_conversacion: z.string().nullish(),
  historial: z.array(MensajeHistorialDTO).default([]),
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

export const ReporteDTO = z.object({
  clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
  instalacion_id: z.string().trim().min(1, 'El identificador de instalacion es obligatorio'),
  datos: z.record(z.string(), z.unknown()),
});

export type ReporteDTO = z.infer<typeof ReporteDTO>;

export interface ReporteResponseDTO {
  texto: string;
  tokens: number;
}

export const UsoConsultaDTO = z.object({
  clave: z.string().trim().min(1),
  instalacion_id: z.string().trim().min(1),
});

export type UsoConsultaDTO = z.infer<typeof UsoConsultaDTO>;
