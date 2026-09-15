import { z } from 'zod';

export const MensajeHistorialDTO = z.object({
  rol: z.enum(['usuario', 'asistente', 'sistema']),
  contenido: z.string(),
});

export type MensajeHistorialDTO = z.infer<typeof MensajeHistorialDTO>;

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
      .array(
        z.object({
          id: z.number(),
          porcentaje: z.number(),
          nombre: z.string(),
          predeterminada: z.boolean(),
        })
      )
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
      .array(
        z.object({
          id: z.number(),
          nombre: z.string(),
        })
      )
      .optional(),
    tablas_sistema: z.array(z.string()).optional(),
    // Fase 1: resumen precocinado del negocio + memoria del comercio (inyección local)
    resumen_negocio: z.string().optional(),
    memoria_comercio: z.string().optional(),
  })
  .passthrough();

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

// --- Agente multi-paso (function calling) ---

/** Límite de pasos con herramientas por ciclo: anti-abuso y control de costo. */
export const AGENTE_MAX_PASOS = 7;

/**
 * Tope de mensajes por ciclo del agente (pregunta + tool_calls + resultados).
 * Un informe complejo (7 pasos × tandas de hasta 6 consultas) llega a ~50
 * items legítimamente: 72 lo cubre con margen y a la vez acota el costo del
 * peor ciclo por diseño. El servicio recorta con gracia si llega más largo
 * (nunca 400 al usuario); el schema solo pone un techo sanitario superior.
 */
export const HISTORIAL_MAX_AGENTE = 72;

const AgenteToolCallDTO = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1).max(100),
    arguments: z.string().max(32_000),
  }),
});

export const MensajeAgenteDTO = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().max(200_000),
  tool_calls: z.array(AgenteToolCallDTO).max(AGENTE_MAX_PASOS).optional(),
  tool_call_id: z.string().max(200).optional(),
  name: z.string().max(100).optional(),
});

export type MensajeAgenteDTO = z.infer<typeof MensajeAgenteDTO>;

/** El primer turno del ciclo usa el mismo formato que PreguntarDTO. */
export const PreguntarAgenteDTO = PreguntarDTO;
export type PreguntarAgenteDTO = z.infer<typeof PreguntarAgenteDTO>;

/**
 * Turnos siguientes del ciclo: el desktop reenvía los mensajes acumulados
 * (pregunta + tool_calls del asistente + resultados role:"tool") SIN el mensaje
 * del sistema — el backend lo reconstruye con `contexto` en cada paso.
 * El backend es stateless: no guarda sesiones entre pasos.
 */
export const ContinuarAgenteDTO = z
  .object({
    clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
    instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
    contexto: ContextoNegocioDTO.optional(),
    historial: z.array(MensajeAgenteDTO).min(1).max(HISTORIAL_MAX_AGENTE * 3),
  })
  .superRefine((data, ctx) => {
    // El mensaje del sistema inicial lo genera el backend con `contexto`;
    // los mensajes system en mitad del array son eventos de cierre de loop
    // del desktop (ej: "✓ Producto creado") y son válidos para el proveedor.
    //
    // Tope anti-abuso en HISTORIAL_MAX_AGENTE resultados: un informe complejo
    // (7 pasos × tandas de 6) trae ~42 legítimamente. Si llega más, el
    // servicio recorta con gracia (nunca se rechaza con 400 al usuario).
    const pasosTool = data.historial.filter((m) => m.role === 'tool').length;
    if (pasosTool > HISTORIAL_MAX_AGENTE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Se superó el máximo de ${HISTORIAL_MAX_AGENTE} resultados de herramientas por ciclo`,
        path: ['historial'],
      });
    }
  });

export type ContinuarAgenteDTO = z.infer<typeof ContinuarAgenteDTO>;

// --- Binny Proactivo: Brief Diario e Informe Semanal (Fase 3) ---
// Ambos validan licencia pero NO consumen cuota: son el diferencial comercial.
// El desktop envía datos ya agregados (nunca filas crudas masivas).

/** Resumen del día compilado localmente por el desktop (KPIs + píldoras). */
export const BriefDTO = z.object({
  clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
  instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
  contexto: ContextoNegocioDTO.optional(),
  resumen: z.string().trim().min(1, 'El resumen es obligatorio').max(60_000),
});

export type BriefDTO = z.infer<typeof BriefDTO>;

/** Datos agregados de la semana compilados localmente por el desktop. */
export const InformeDTO = z.object({
  clave: z.string().trim().min(1, 'La clave de licencia es obligatoria'),
  instalacion_id: z.string().trim().min(1, 'El identificador de instalación es obligatorio'),
  contexto: ContextoNegocioDTO.optional(),
  periodo: z.string().trim().max(100).optional(),
  datos: z.string().trim().min(1, 'Los datos son obligatorios').max(120_000),
});

export type InformeDTO = z.infer<typeof InformeDTO>;

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
