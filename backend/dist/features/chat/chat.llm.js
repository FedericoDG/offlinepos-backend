import { env } from '../../config/env';
let controlador = null;
const TIMEOUT_LLAMADA_MS = 60_000; // 60s total para llamarLLM (JSON completo)
const TIMEOUT_CONEXION_MS = 30_000; // 30s para que el proveedor responda headers
const TIMEOUT_STALL_MS = 30_000; // 30s sin datos → abortar stream
export async function llamarLLM(mensajes, opciones = {}) {
    const { jsonMode = true } = opciones;
    if (controlador) {
        controlador.abort();
    }
    controlador = new AbortController();
    const ctrl = controlador;
    try {
        const body = {
            model: env.LLM_MODEL,
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
        const data = (await respuesta.json());
        const contenido = data.choices?.[0]?.message?.content;
        if (!contenido) {
            throw new Error('El proveedor LLM devolvió una respuesta vacía');
        }
        let respuestaParsed;
        if (jsonMode) {
            // Modo JSON: parsear y validar
            const parsed = JSON.parse(contenido);
            if (!esRespuestaLLM(parsed)) {
                console.error('[LLM] Respuesta con formato inválido:', contenido);
                throw new Error('El proveedor LLM devolvió un formato inesperado');
            }
            respuestaParsed = parsed;
        }
        else {
            // Modo texto plano: envolver como respuesta directa
            // Defensa: si el modelo igualmente envuelve en JSON (ej: {"output": "..."}), intentar extraer
            let textoFinal = contenido;
            if (contenido.trimStart().startsWith('{')) {
                try {
                    const posParse = JSON.parse(contenido);
                    textoFinal = posParse.texto ?? posParse.output ?? posParse.content ?? contenido;
                }
                catch {
                    // No era JSON, usar tal cual
                }
            }
            respuestaParsed = { tipo: 'respuesta', texto: textoFinal.trim() };
        }
        const tokens = {
            prompt_tokens: data.usage?.prompt_tokens ?? 0,
            completion_tokens: data.usage?.completion_tokens ?? 0,
            total_tokens: data.usage?.total_tokens ?? 0,
            cached_tokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        };
        console.log(`[LLM] Tokens — prompt: ${tokens.prompt_tokens}, completion: ${tokens.completion_tokens}, total: ${tokens.total_tokens}, cached: ${tokens.cached_tokens}`);
        return { respuesta: respuestaParsed, tokens };
    }
    finally {
        if (ctrl === controlador) {
            controlador = null;
        }
    }
}
function esRespuestaLLM(valor) {
    if (typeof valor !== 'object' || valor === null)
        return false;
    const obj = valor;
    if (obj.tipo !== 'respuesta' && obj.tipo !== 'consulta')
        return false;
    if (obj.tipo === 'respuesta') {
        return typeof obj.texto === 'string' && obj.texto.length > 0;
    }
    return (typeof obj.id_solicitud === 'string' &&
        typeof obj.sql === 'string' &&
        typeof obj.descripcion === 'string');
}
export async function* llamarLLMStream(mensajes, opciones = {}) {
    const centinela = opciones.centinela ?? '@REINTENTAR';
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
        let tokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };
        let cola = '';
        let modoCentinela = false;
        let jsonCentinela = '';
        // Race entre reader.read() y un timer de stall
        const raceStall = (p) => Promise.race([
            p.then((v) => ({ ok: true, ...v })),
            new Promise((r) => setTimeout(() => r({ ok: false }), TIMEOUT_STALL_MS)),
        ]);
        while (true) {
            const resultado = await raceStall(reader.read());
            if (!resultado.ok) {
                yield { type: 'error', texto: 'El proveedor LLM dejó de responder (timeout)' };
                return;
            }
            if (resultado.done)
                break;
            const value = resultado.value;
            buffer += decoder.decode(value, { stream: true });
            const lineas = buffer.split('\n');
            buffer = lineas.pop() ?? '';
            for (const linea of lineas) {
                const trimmed = linea.trim();
                if (!trimmed || !trimmed.startsWith('data:'))
                    continue;
                const data = trimmed.slice(5).trim();
                if (data === '[DONE]')
                    continue;
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
                    const delta = parsed.choices?.[0]?.delta?.content;
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
                                }
                                catch {
                                    // JSON incompleto, seguir acumulando
                                }
                            }
                            if (jsonCentinela.length > 4096) {
                                yield { type: 'error', texto: 'El LLM pidió reintento pero no pude entender la consulta' };
                                return;
                            }
                        }
                        else {
                            const candidato = cola + delta;
                            const idx = candidato.indexOf(centinela);
                            if (idx >= 0) {
                                // Centinela encontrado: emitir texto previo y entrar en modo centinela
                                modoCentinela = true;
                                const textoPrevio = candidato.slice(0, idx);
                                if (textoPrevio)
                                    yield { type: 'chunk', texto: textoPrevio };
                                jsonCentinela = candidato.slice(idx + centinela.length);
                                // Intentar parsear si ya hay suficiente
                                const limpio = jsonCentinela.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
                                if (limpio.length >= 2) {
                                    try {
                                        const parsedConsulta = JSON.parse(limpio);
                                        yield { type: 'consulta', respuesta: parsedConsulta };
                                        return;
                                    }
                                    catch { /* seguir acumulando */ }
                                }
                                if (jsonCentinela.length > 4096) {
                                    yield { type: 'error', texto: 'El LLM pidió reintento pero no pude entender la consulta' };
                                    return;
                                }
                            }
                            else {
                                // No encontrado: retener sufijo potencial y emitir el resto
                                let nuevaCola = '';
                                for (let k = Math.min(centinela.length - 1, candidato.length); k >= 1; k--) {
                                    if (candidato.endsWith(centinela.slice(0, k))) {
                                        nuevaCola = candidato.slice(-k);
                                        break;
                                    }
                                }
                                const aEmitir = candidato.slice(0, candidato.length - nuevaCola.length);
                                if (aEmitir)
                                    yield { type: 'chunk', texto: aEmitir };
                                cola = nuevaCola;
                            }
                        }
                    }
                }
                catch {
                    // Chunk inválido, ignorar
                }
            }
        }
        // Flush de cola pendiente (centinela parcial o texto restante)
        if (!modoCentinela && cola.length > 0) {
            yield { type: 'chunk', texto: cola };
        }
        console.log(`[LLM Stream] Tokens — prompt: ${tokens.prompt_tokens}, completion: ${tokens.completion_tokens}, total: ${tokens.total_tokens}, cached: ${tokens.cached_tokens}`);
        yield { type: 'done', texto: textoCompleto, tokens };
    }
    catch (error) {
        if (ctrl.signal.aborted)
            return;
        yield { type: 'error', texto: `Error en stream: ${error}` };
    }
}
