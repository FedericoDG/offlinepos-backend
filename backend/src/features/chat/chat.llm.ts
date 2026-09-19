import { env } from '../../config/env';
import { type RespuestaLLM } from './chat.dtos';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMChoice {
  message: { content: string };
}

interface LLMUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface LLMResponse {
  choices: LLMChoice[];
  usage?: LLMUsage;
}

export interface TokensUsados {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
}

const TIMEOUT_LLAMADA_MS = 60_000;   // 60s total para llamarLLM (JSON completo)
const TIMEOUT_CONEXION_MS = 30_000;  // 30s para que el proveedor responda headers
const TIMEOUT_STALL_MS = 30_000;     // 30s sin datos → abortar stream

export async function llamarLLM(
  mensajes: ChatMessage[],
  opciones: { jsonMode?: boolean; model?: string } = {},
): Promise<{ respuesta: RespuestaLLM; tokens: TokensUsados }> {
  const { jsonMode = true, model = env.LLM_MODEL } = opciones;

  // Controlador por llamada: el anterior era un AbortController global compartido
  // y una llamada concurrente abortaba el stream de otro usuario/comercio.
  const ctrl = new AbortController();

  const body: Record<string, unknown> = {
    model,
    messages: mensajes,
    temperature: 0.1,
    enable_thinking: env.LLM_ENABLE_THINKING,
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const respuesta = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(TIMEOUT_LLAMADA_MS)]),
  });

  if (!respuesta.ok) {
    const texto = await respuesta.text();
    console.error('[LLM] Error del proveedor:', respuesta.status, texto);
    throw new Error(`Error del proveedor LLM (código ${respuesta.status})`);
  }

    const data = (await respuesta.json()) as LLMResponse;
    // Saneamiento determinista: quitar <think> antes de parsear o envolver.
    const contenido = sanearTextoLLM(data.choices?.[0]?.message?.content);

  if (!contenido) {
    throw new Error('El proveedor LLM devolvió una respuesta vacía');
  }

  let respuestaParsed: RespuestaLLM;

  if (jsonMode) {
    // Modo JSON: parsear y validar
    const parsed = JSON.parse(contenido) as unknown;
    if (!esRespuestaLLM(parsed)) {
      console.error('[LLM] Respuesta con formato inválido:', contenido);
      throw new Error('El proveedor LLM devolvió un formato inesperado');
    }
    respuestaParsed = parsed;
  } else {
    // Modo texto plano: envolver como respuesta directa
    // Defensa: si el modelo igualmente envuelve en JSON (ej: {"output": "..."}), intentar extraer
    let textoFinal = contenido;
    if (contenido.trimStart().startsWith('{')) {
      try {
        const posParse = JSON.parse(contenido);
        textoFinal = posParse.texto ?? posParse.output ?? posParse.content ?? contenido;
      } catch {
        // No era JSON, usar tal cual
      }
    }
    respuestaParsed = { tipo: 'respuesta', texto: textoFinal.trim() };
  }

  const tokens: TokensUsados = {
    prompt_tokens: data.usage?.prompt_tokens ?? 0,
    completion_tokens: data.usage?.completion_tokens ?? 0,
    total_tokens: data.usage?.total_tokens ?? 0,
    cached_tokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };

  console.log(
    `[LLM] Tokens — prompt: ${tokens.prompt_tokens}, completion: ${tokens.completion_tokens}, total: ${tokens.total_tokens}, cached: ${tokens.cached_tokens}`
  );

  return { respuesta: respuestaParsed, tokens };
}

function esRespuestaLLM(valor: unknown): valor is RespuestaLLM {
  if (typeof valor !== 'object' || valor === null) return false;
  const obj = valor as Record<string, unknown>;
  if (obj.tipo !== 'respuesta' && obj.tipo !== 'consulta') return false;
  if (obj.tipo === 'respuesta') {
    return typeof obj.texto === 'string' && obj.texto.length > 0;
  }
  return (
    typeof obj.id_solicitud === 'string' &&
    typeof obj.sql === 'string' &&
    typeof obj.descripcion === 'string'
  );
}

// --- Streaming ---

interface StreamChunk {
  type: 'chunk' | 'done' | 'error' | 'consulta';
  texto?: string;
  tokens?: TokensUsados;
  respuesta?: RespuestaLLM;
}

export async function* llamarLLMStream(
  mensajes: ChatMessage[],
  opciones: { centinela?: string; model?: string } = {},
): AsyncGenerator<StreamChunk> {
  const centinela = opciones.centinela ?? '@REINTENTAR';
  const model = opciones.model ?? env.LLM_MODEL;
  const ctrl = new AbortController();

  try {
    const respuesta = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: mensajes,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.1,
        enable_thinking: env.LLM_ENABLE_THINKING,
      }),
      signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(TIMEOUT_CONEXION_MS)]),
    });

    if (!respuesta.ok) {
      const texto = await respuesta.text();
      console.error('[LLM Stream] Error del proveedor:', respuesta.status, texto);
      yield { type: 'error', texto: `Error del proveedor LLM (código ${respuesta.status})` };
      return;
    }

    const reader = respuesta.body?.getReader();
    if (!reader) {
      yield { type: 'error', texto: 'No se pudo leer el stream del proveedor' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let textoCompleto = '';
    let tokens: TokensUsados = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };
    let cola = '';
    let modoCentinela = false;
    let jsonCentinela = '';
    const supresor = new SupresorThink();

    // Race entre reader.read() y un timer de stall
    const raceStall = (p: Promise<{ done: boolean; value?: Uint8Array }>) =>
      Promise.race([
        p.then((v) => ({ ok: true as const, ...v })),
        new Promise<{ ok: false }>((r) => setTimeout(() => r({ ok: false }), TIMEOUT_STALL_MS)),
      ]);

    while (true) {
      const resultado = await raceStall(reader.read());
      if (!resultado.ok) {
        yield { type: 'error', texto: 'El proveedor LLM dejó de responder (timeout)' };
        return;
      }
      if (resultado.done) break;
      const value = resultado.value;

      buffer += decoder.decode(value, { stream: true });
      const lineas = buffer.split('\n');
      buffer = lineas.pop() ?? '';

      for (const linea of lineas) {
        const trimmed = linea.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);

          if (parsed.usage) {
            tokens = {
              prompt_tokens: parsed.usage.prompt_tokens ?? 0,
              completion_tokens: parsed.usage.completion_tokens ?? 0,
              total_tokens: parsed.usage.total_tokens ?? 0,
              cached_tokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? 0,
            };
          }

          const deltaRaw = parsed.choices?.[0]?.delta?.content;
          // Suprimir <think> antes de detectar centinela o emitir chunks.
          const delta = typeof deltaRaw === 'string' ? supresor.procesar(deltaRaw) : '';
          if (delta) {
            textoCompleto += delta;

            if (modoCentinela) {
              // Acumular hasta JSON parseable
              jsonCentinela += delta;
              const limpio = jsonCentinela.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
              if (limpio.length >= 2) {
                try {
                  const parsedConsulta = JSON.parse(limpio);
                  yield { type: 'consulta', respuesta: parsedConsulta };
                  return;
                } catch {
                  // JSON incompleto, seguir acumulando
                }
              }
              if (jsonCentinela.length > 4096) {
                yield { type: 'error', texto: 'El LLM pidió reintento pero no pude entender la consulta' };
                return;
              }
            } else {
              const candidato = cola + delta;
              const idx = candidato.indexOf(centinela);

              if (idx >= 0) {
                // Centinela encontrado: emitir texto previo y entrar en modo centinela
                modoCentinela = true;
                const textoPrevio = candidato.slice(0, idx);
                if (textoPrevio) yield { type: 'chunk', texto: textoPrevio };
                jsonCentinela = candidato.slice(idx + centinela.length);
                // Intentar parsear si ya hay suficiente
                const limpio = jsonCentinela.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
                if (limpio.length >= 2) {
                  try {
                    const parsedConsulta = JSON.parse(limpio);
                    yield { type: 'consulta', respuesta: parsedConsulta };
                    return;
                  } catch { /* seguir acumulando */ }
                }
                if (jsonCentinela.length > 4096) {
                  yield { type: 'error', texto: 'El LLM pidió reintento pero no pude entender la consulta' };
                  return;
                }
              } else {
                // No encontrado: retener sufijo potencial y emitir el resto
                let nuevaCola = '';
                for (let k = Math.min(centinela.length - 1, candidato.length); k >= 1; k--) {
                  if (candidato.endsWith(centinela.slice(0, k))) {
                    nuevaCola = candidato.slice(-k);
                    break;
                  }
                }
                const aEmitir = candidato.slice(0, candidato.length - nuevaCola.length);
                if (aEmitir) yield { type: 'chunk', texto: aEmitir };
                cola = nuevaCola;
              }
            }
          }
        } catch {
          // Chunk inválido, ignorar
        }
      }
    }

    // Flush de cola pendiente (centinela parcial o texto restante)
    if (!modoCentinela && cola.length > 0) {
      yield { type: 'chunk', texto: cola };
    }
    // Flush del supresor de <think>: cola retenida por posible tag cortado.
    const restoThink = supresor.flush();
    if (restoThink) {
      textoCompleto += restoThink;
      if (modoCentinela) {
        jsonCentinela += restoThink;
      } else {
        yield { type: 'chunk', texto: restoThink };
      }
    }

    console.log(
      `[LLM Stream] Tokens — prompt: ${tokens.prompt_tokens}, completion: ${tokens.completion_tokens}, total: ${tokens.total_tokens}, cached: ${tokens.cached_tokens}`
    );

    yield { type: 'done', texto: textoCompleto, tokens };
  } catch (error) {
    if (ctrl.signal.aborted) return;
    yield { type: 'error', texto: `Error en stream: ${error}` };
  }
}

// --- Agente multi-paso (function calling nativo, OpenAI-compatible) ---

export interface AgenteToolCall {
  id: string;
  nombre: string;
  /** Argumentos JSON en crudo, tal como los generó el modelo. */
  argumentos: string;
}

export interface AgenteToolCallWire {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface AgenteMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: AgenteToolCallWire[];
  tool_call_id?: string;
  name?: string;
}

export interface AgenteToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type AgenteEvento =
  | { type: 'chunk'; texto: string }
  | { type: 'herramienta'; tool_calls: AgenteToolCall[] }
  | { type: 'done'; texto: string; tokens: TokensUsados }
  | { type: 'error'; texto: string };

const MAX_ARGS_TOOL_BYTES = 16 * 1024; // 16 KB de argumentos por tool call

/**
 * Llama al LLM con herramientas (tools) en modo streaming.
 *
 * Emite `chunk` para texto incremental y un único evento `herramienta` con los
 * tool calls completos cuando el proveedor termina con finish_reason "tool_calls".
 * Si el modelo responde solo texto, el comportamiento es idéntico al stream normal.
 */
export async function* llamarLLMAgenteStream(
  mensajes: AgenteMessage[],
  tools: AgenteToolDef[],
  opciones: { forzarRespuestaFinal?: boolean; model?: string; sinHerramientas?: boolean; forzarHerramienta?: string } = {},
): AsyncGenerator<AgenteEvento> {
  const { forzarRespuestaFinal = false, model = env.LLM_MODEL, sinHerramientas = false, forzarHerramienta } = opciones;
  const ctrl = new AbortController();

  try {
    const body: Record<string, unknown> = {
      model,
      messages: mensajes,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.1,
      // Los modelos Qwen3 generan tool calls confiables en modo no-thinking;
      // el modo thinking puede deformar el formato y romper el loop del agente.
      enable_thinking: false,
    };
    // Sin herramientas definidas el proveedor no puede devolver tool_calls:
    // se usa en cierres forzados donde solo vale texto final.
    if (!sinHerramientas) {
      body.tools = tools;
      // forzarHerramienta exige un tool concreto (ej: memoria automática):
      // el proveedor debe devolver ese function call, no texto ni fences.
      body.tool_choice = forzarHerramienta
        ? { type: 'function', function: { name: forzarHerramienta } }
        : forzarRespuestaFinal ? 'none' : 'auto';
    }

    const respuesta = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(TIMEOUT_CONEXION_MS)]),
    });

    if (!respuesta.ok) {
      const texto = await respuesta.text();
      console.error('[LLM Agente] Error del proveedor:', respuesta.status, texto);
      yield { type: 'error', texto: `Error del proveedor LLM (código ${respuesta.status})` };
      return;
    }

    const reader = respuesta.body?.getReader();
    if (!reader) {
      yield { type: 'error', texto: 'No se pudo leer el stream del proveedor' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let textoCompleto = '';
    let tokens: TokensUsados = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };
    let finishReason: string | null = null;

    // Acumuladores de tool calls por índice (los deltas llegan fragmentados)
    const llamadas: Array<{ id: string; nombre: string; argumentos: string }> = [];
    const supresor = new SupresorThink();

    const raceStall = (p: Promise<{ done: boolean; value?: Uint8Array }>) =>
      Promise.race([
        p.then((v) => ({ ok: true as const, ...v })),
        new Promise<{ ok: false }>((r) => setTimeout(() => r({ ok: false }), TIMEOUT_STALL_MS)),
      ]);

    while (true) {
      const resultado = await raceStall(reader.read());
      if (!resultado.ok) {
        yield { type: 'error', texto: 'El proveedor LLM dejó de responder (timeout)' };
        return;
      }
      if (resultado.done) break;
      const value = resultado.value;

      buffer += decoder.decode(value, { stream: true });
      const lineas = buffer.split('\n');
      buffer = lineas.pop() ?? '';

      for (const linea of lineas) {
        const trimmed = linea.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data) as {
            usage?: LLMUsage;
            choices?: Array<{
              finish_reason?: string | null;
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };

          if (parsed.usage) {
            tokens = {
              prompt_tokens: parsed.usage.prompt_tokens ?? 0,
              completion_tokens: parsed.usage.completion_tokens ?? 0,
              total_tokens: parsed.usage.total_tokens ?? 0,
              cached_tokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? 0,
            };
          }

          const choice = parsed.choices?.[0];
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }

          const delta = choice?.delta;
          if (!delta) continue;

          if (typeof delta.content === 'string' && delta.content.length > 0) {
            const visible = supresor.procesar(delta.content);
            if (visible.length > 0) {
              textoCompleto += visible;
              yield { type: 'chunk', texto: visible };
            }
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = typeof tc.index === 'number' ? tc.index : 0;
              if (!llamadas[idx]) {
                llamadas[idx] = { id: '', nombre: '', argumentos: '' };
              }
              if (tc.id) llamadas[idx].id = tc.id;
              if (tc.function?.name) llamadas[idx].nombre += tc.function.name;
              if (tc.function?.arguments) llamadas[idx].argumentos += tc.function.arguments;
              if (llamadas[idx].argumentos.length > MAX_ARGS_TOOL_BYTES) {
                yield { type: 'error', texto: 'El LLM generó una llamada a herramienta demasiado grande' };
                return;
              }
            }
          }
        } catch {
          // Chunk inválido, ignorar
        }
      }
    }

    console.log(
      `[LLM Agente] Tokens — prompt: ${tokens.prompt_tokens}, completion: ${tokens.completion_tokens}, total: ${tokens.total_tokens}, cached: ${tokens.cached_tokens}, finish: ${finishReason}, tools: ${llamadas.length}`
    );

    // Flush del supresor: cola retenida por posible tag cortado (vacío si quedó think abierto).
    textoCompleto += supresor.flush();

    if (finishReason === 'tool_calls' || llamadas.some((l) => l && (l.id || l.nombre))) {
      const completas: AgenteToolCall[] = llamadas
        .filter((l) => l && l.nombre)
        .map((l) => ({ id: l.id || `tool_${Date.now()}`, nombre: l.nombre, argumentos: l.argumentos }));
      if (completas.length === 0) {
        yield { type: 'error', texto: 'El LLM pidió usar una herramienta pero no pude interpretar la llamada' };
        return;
      }
      yield { type: 'herramienta', tool_calls: completas };
      return;
    }

    yield { type: 'done', texto: textoCompleto, tokens };
  } catch (error) {
    if (ctrl.signal.aborted) return;
    yield { type: 'error', texto: `Error en stream del agente: ${error}` };
  }
}

// --- Saneamiento anti-razonamiento visible ---
//
// Aunque el modo thinking está apagado, el proveedor puede devolver bloques
// <think>...</think> o el modelo puede divagar. Esto lo recorta de forma
// determinística (código, no IA).

const THINK_COMPLETO_RE = /<think>[\s\S]*?(<\/think\s*>|$)/gi;

/** Quita bloques <think>...</think> de un texto completo. */
export function sanearTextoLLM(texto: string): string {
  if (!texto) return texto;
  return texto.replace(THINK_COMPLETO_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Suprime bloques <think> de un stream sin romper el streaming normal.
 * Uso: por cada delta llamar a procesar() y emitir lo que devuelve;
 * al cerrar el stream, emitir flush().
 */
export class SupresorThink {
  private dentro = false;
  private resto = '';

  procesar(delta: string): string {
    let texto = this.resto + delta;
    this.resto = '';
    let salida = '';
    // Iteraciones acotadas: el texto se achica en cada vuelta salvo retención.
    for (let i = 0; i < 10 && texto.length > 0; i++) {
      if (!this.dentro) {
        const ini = texto.search(/<think(?=[\s>])/i);
        if (ini === -1) {
          // Retener cola corta por si es un tag cortado entre chunks.
          const corte = Math.max(0, texto.length - 7);
          salida += texto.slice(0, corte);
          this.resto = texto.slice(corte);
          break;
        }
        salida += texto.slice(0, ini);
        texto = texto.slice(ini);
        this.dentro = true;
      } else {
        const m = /<\/think\s*>/i.exec(texto);
        if (!m || m.index === undefined) {
          // Todo pensamiento por ahora: descartar, salvo posible cierre parcial.
          const parcial = /<\/?[a-z]*$/i.exec(texto);
          this.resto = parcial ? parcial[0] : '';
          break;
        }
        texto = texto.slice(m.index + m[0].length);
        this.dentro = false;
      }
    }
    return salida;
  }

  flush(): string {
    // Si quedó un think sin cerrar, se descarta entero.
    if (this.dentro) {
      this.resto = '';
      return '';
    }
    // Cola normal: quitar un posible tag parcial al final.
    const r = this.resto.replace(/<+\/?[a-z]*$/i, '');
    this.resto = '';
    return r;
  }
}

// --- Detección de deliberación filtrada (observabilidad, no modifica nada) ---

const MARCADORES_DELIBERACION: RegExp[] = [
  /revisemos las reglas|revisar las reglas/i,
  /re-?leyendo/i,
  /hay un error en mi/i,
  /nota:\s*(ac[aá]|arriba|encima)/i,
  /(espera|esper[áa]),?\s+(revis|re-?ley|repens|recalc)/i,
  /me equivoqu[eé]\s+(al|en|con|aca|ac[aá])/i,
  /como (un )?modelo de lenguaje/i,
  /mis instrucciones dicen|seg[úu]n mis instrucciones/i,
  /debo usar la l[óo]gica correcta/i,
];

/** Devuelve los fragmentos que sugieren razonamiento interno visible. */
export function detectarDeliberacion(texto: string): string[] {
  if (!texto) return [];
  const hallados: string[] = [];
  for (const re of MARCADORES_DELIBERACION) {
    const m = re.exec(texto);
    if (m && m[0]) hallados.push(m[0].slice(0, 80));
  }
  return hallados;
}

export interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessageVision {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

const TIMEOUT_VISION_MS = 90_000;

export async function llamarLLMVision(
  mensajes: ChatMessageVision[],
  opciones: { jsonMode?: boolean; model?: string } = {},
): Promise<{ texto: string; tokens: TokensUsados }> {
  const { jsonMode = true, model = env.LLM_VISION_MODEL || env.LLM_MODEL } = opciones;

  const ctrl = new AbortController();

  try {
    const body: Record<string, unknown> = {
      model,
      messages: mensajes,
      temperature: 0.1,
    };
    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const respuesta = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(TIMEOUT_VISION_MS)]),
    });

    if (!respuesta.ok) {
      const texto = await respuesta.text();
      console.error('[LLM Vision] Error del proveedor:', respuesta.status, texto);
      throw new Error(`Error del proveedor LLM Vision (código ${respuesta.status})`);
    }

    const data = (await respuesta.json()) as LLMResponse;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('El proveedor LLM Vision no devolvió respuesta');
    }

    const contenido = sanearTextoLLM(choice.message?.content ?? '');
    const usage = data.usage;
    const tokens: TokensUsados = {
      prompt_tokens: usage?.prompt_tokens ?? 0,
      completion_tokens: usage?.completion_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0,
      cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };

    return { texto: contenido, tokens };
  } catch (error) {
    if (ctrl.signal.aborted) {
      throw new Error('La llamada a la IA de visión fue cancelada por timeout');
    }
    throw error;
  }
}

