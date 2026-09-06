import { env } from '../../config/env';
let controlador = null;
export async function llamarLLM(mensajes) {
    if (controlador) {
        controlador.abort();
    }
    controlador = new AbortController();
    const ctrl = controlador;
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
                response_format: { type: 'json_object' },
                temperature: 0.1,
            }),
            signal: ctrl.signal,
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
        const parsed = JSON.parse(contenido);
        if (!esRespuestaLLM(parsed)) {
            console.error('[LLM] Respuesta con formato inválido:', contenido);
            throw new Error('El proveedor LLM devolvió un formato inesperado');
        }
        return parsed;
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
