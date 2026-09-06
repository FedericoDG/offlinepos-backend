import { env } from '../../config/env';
import { type RespuestaLLM } from './chat.dtos';

interface ChatMessage {
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
}

interface LLMResponse {
  choices: LLMChoice[];
  usage?: LLMUsage;
}

export interface TokensUsados {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

let controlador: AbortController | null = null;

export async function llamarLLM(
  mensajes: ChatMessage[],
  opciones: { jsonMode?: boolean } = {},
): Promise<{ respuesta: RespuestaLLM; tokens: TokensUsados }> {
  const { jsonMode = true } = opciones;

  if (controlador) {
    controlador.abort();
  }
  controlador = new AbortController();
  const ctrl = controlador;

  try {
    const body: Record<string, unknown> = {
      model: env.LLM_MODEL,
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
      signal: ctrl.signal,
    });

    if (!respuesta.ok) {
      const texto = await respuesta.text();
      console.error('[LLM] Error del proveedor:', respuesta.status, texto);
      throw new Error(`Error del proveedor LLM (código ${respuesta.status})`);
    }

    const data = (await respuesta.json()) as LLMResponse;
    const contenido = data.choices?.[0]?.message?.content;

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
    };

    console.log(
      `[LLM] Tokens — prompt: ${tokens.prompt_tokens}, completion: ${tokens.completion_tokens}, total: ${tokens.total_tokens}`
    );

    return { respuesta: respuestaParsed, tokens };
  } finally {
    if (ctrl === controlador) {
      controlador = null;
    }
  }
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

export async function* llamarLLMStream(mensajes: ChatMessage[]): AsyncGenerator<StreamChunk> {
  const ctrl = new AbortController();

  try {
    const respuesta = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: mensajes,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.1,
      }),
      signal: ctrl.signal,
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
    let tokens: TokensUsados = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let bufferDetect = ''; // Buffer para detectar @REINTENTAR
    let detectado = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

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

          // Tokens del último chunk
          if (parsed.usage) {
            tokens = {
              prompt_tokens: parsed.usage.prompt_tokens ?? 0,
              completion_tokens: parsed.usage.completion_tokens ?? 0,
              total_tokens: parsed.usage.total_tokens ?? 0,
            };
          }

          // Delta de contenido
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            textoCompleto += delta;

            // Detección de @REINTENTAR (solo al inicio)
            if (!detectado) {
              bufferDetect += delta;
              // Verificar si empieza con @REINTENTAR (tolerando espacios y code fences)
              const trimmedDetect = bufferDetect.replace(/^\s*```(?:json)?\s*/i, '').trimStart();
              if (trimmedDetect.startsWith('@REINTENTAR')) {
                detectado = true;
                // Extraer el JSON después de @REINTENTAR
                const jsonStr = trimmedDetect.slice('@REINTENTAR'.length).trim();
                // Limpiar code fences si los hay
                const jsonLimpio = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
                try {
                  const parsedConsulta = JSON.parse(jsonLimpio);
                  console.log('[LLM Stream] Reintento detectado:', parsedConsulta);
                  yield { type: 'consulta', respuesta: parsedConsulta };
                } catch (parseErr) {
                  console.error('[LLM Stream] Error parseando @REINTENTAR:', parseErr, jsonLimpio);
                  // No parseó el JSON — tratar como error
                  yield { type: 'error', texto: 'El LLM pidió reintento pero no pude entender la consulta' };
                }
                return; // No emitir más eventos
              }
              // Si bufferDetect tiene suficiente texto y NO es @REINTENTAR, dejar de bufferear
              if (bufferDetect.length >= 30) {
                detectado = true;
                // Enviar el buffer como chunk normal
                yield { type: 'chunk', texto: bufferDetect };
                bufferDetect = '';
              }
            } else {
              // Ya pasó la fase de detección — emitir chunk normal
              yield { type: 'chunk', texto: delta };
            }
          }
        } catch {
          // Chunk inválido, ignorar
        }
      }
    }

    // Si el buffer de detección tenía contenido sin emitir (caso edge)
    if (!detectado && bufferDetect.length > 0) {
      yield { type: 'chunk', texto: bufferDetect };
    }

    console.log(
      `[LLM Stream] Tokens — prompt: ${tokens.prompt_tokens}, completion: ${tokens.completion_tokens}, total: ${tokens.total_tokens}`
    );

    yield { type: 'done', texto: textoCompleto, tokens };
  } catch (error) {
    if (ctrl.signal.aborted) return;
    yield { type: 'error', texto: `Error en stream: ${error}` };
  }
}
