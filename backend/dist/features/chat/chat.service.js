import prisma from '../../config/prisma';
import { decrypt } from '../../utils/encryption';
import { env } from '../../config/env';
import { httpError } from '../../utils/api-error';
import { ESQUEMA_SQLITE, EJEMPLOS_CONSULTAS } from './chat.esquema';
import { llamarLLM } from './chat.llm';
import { validarSQL } from './chat.guarda';
const rateLimitMap = new Map();
function hoyStr() {
    return new Date().toISOString().slice(0, 10);
}
function verificarRateLimit(clave) {
    const hoy = hoyStr();
    const registro = rateLimitMap.get(clave);
    if (!registro || registro.fecha !== hoy) {
        rateLimitMap.set(clave, { fecha: hoy, contador: 1 });
        return;
    }
    if (registro.contador >= env.CHAT_MENSAJES_DIA) {
        httpError('Has alcanzado el limite diario de mensajes del asistente. Intenta manana.', 429);
    }
    registro.contador++;
}
// --- Validacion de licencia ---
async function validarLicencia(clave, instalacionId) {
    const licencias = await prisma.licencia.findMany();
    let licenciaEncontrada = null;
    for (const lic of licencias) {
        try {
            const claveDescifrada = decrypt(lic.clave_hash);
            if (claveDescifrada === clave) {
                licenciaEncontrada = lic;
                break;
            }
        }
        catch {
            continue;
        }
    }
    if (!licenciaEncontrada) {
        httpError('Licencia no encontrada', 404);
    }
    if (licenciaEncontrada.estado !== 'activa') {
        httpError('La licencia no esta activa', 403);
    }
    const activacion = await prisma.activacion.findUnique({
        where: {
            licencia_id_instalacion_id: {
                licencia_id: licenciaEncontrada.id,
                instalacion_id: instalacionId,
            },
        },
    });
    if (!activacion) {
        httpError('Esta instalacion no tiene una activacion valida', 403);
    }
}
// --- Prompt del sistema ---
function construirPromptSistema() {
    const ejemplos = EJEMPLOS_CONSULTAS.map((e) => `Pregunta: "${e.pregunta}"\nSQL: \`${e.sql}\``).join('\n\n');
    return `Sos un asistente inteligente para un sistema POS (punto de venta). Tu tarea es responder preguntas del usuario sobre su negocio consultando la base de datos SQLite local.

## Reglas estrictas
1. SOLO podes generar consultas SELECT o WITH (lectura). NUNCA generes INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
2. TODA consulta DEBE incluir un LIMIT (maximo 500).
3. Si el usuario hace una pregunta general (no necesita datos), respondé directamente con {tipo: "respuesta", texto: "..."}.
4. Si necesitas datos de la base, respondé con {tipo: "consulta", id_solicitud: "<uuid corto>", sql: "...", descripcion: "Breve descripcion de que consulta vas a ejecutar"}.
5. Las fechas en la base son timestamps Unix en segundos. Para "hoy" usa DATE('now', 'localtime'). Para "este mes" usa strftime('%s', 'now', 'start of month').
6. Los precios y montos son numeros reales.
7. Respondé SIEMPRE en espanol.
8. Se conciso y directo en tus respuestas.
9. Si la consulta tiene muchos resultados, resume la info clave.
10. Para comparar fechas, recorda que la columna es un INTEGER Unix timestamp.

## Formato de respuesta
Cuando necesitas datos: {tipo: "consulta", id_solicitud: "abc123", sql: "SELECT ...", descripcion: "Descripcion breve"}
Cuando respondes directamente: {tipo: "respuesta", texto: "Respuesta completa"}

## Ejemplos de consultas exitosas
${ejemplos}

## Estructura de la base de datos
${ESQUEMA_SQLITE}`;
}
// --- Servicio principal ---
export class ChatService {
    async preguntar(data) {
        await validarLicencia(data.clave, data.instalacion_id);
        verificarRateLimit(data.clave);
        const mensajes = [
            { role: 'system', content: construirPromptSistema() },
        ];
        for (const msg of data.historial.slice(-10)) {
            const rol = msg.rol === 'asistente' ? 'assistant' : msg.rol === 'sistema' ? 'system' : 'user';
            mensajes.push({ role: rol, content: msg.contenido });
        }
        mensajes.push({ role: 'user', content: data.pregunta });
        const respuesta = await llamarLLM(mensajes);
        if (respuesta.tipo === 'consulta') {
            const validacion = validarSQL(respuesta.sql);
            if (!validacion.valido) {
                return {
                    tipo: 'respuesta',
                    texto: `No puedo ejecutar esa consulta: ${validacion.error}. Podes reformular tu pregunta?`,
                };
            }
        }
        return respuesta;
    }
    async resultado(data) {
        await validarLicencia(data.clave, data.instalacion_id);
        const mensajes = [
            { role: 'system', content: construirPromptSistema() },
        ];
        if (data.error) {
            mensajes.push({
                role: 'assistant',
                content: JSON.stringify({ tipo: 'consulta', id_solicitud: data.id_solicitud, sql: data.sql, descripcion: 'Consulta previa' }),
            });
            mensajes.push({
                role: 'user',
                content: `La consulta fallo con este error: ${data.error}. Podes generar una consulta alternativa o responder directamente?`,
            });
        }
        else {
            const filasJson = JSON.stringify(data.filas);
            const truncado = data.recortado ? ' (resultados truncados por cantidad)' : '';
            mensajes.push({
                role: 'assistant',
                content: JSON.stringify({ tipo: 'consulta', id_solicitud: data.id_solicitud, sql: data.sql, descripcion: 'Consulta ejecutada' }),
            });
            mensajes.push({
                role: 'user',
                content: `Resultados de la consulta SQL (${data.filas.length} filas${truncado}):\n${filasJson}\n\nAhora analiza estos resultados y responde al usuario en espanol, de forma concisa y clara. Si hay mucha info, resume los puntos clave.`,
            });
        }
        const respuesta = await llamarLLM(mensajes);
        return respuesta;
    }
}
