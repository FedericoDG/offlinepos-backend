import prisma from '../../config/prisma';
import { decrypt } from '../../utils/encryption';
import { env } from '../../config/env';
import { httpError } from '../../utils/api-error';
import { PreguntarDTO, ResultadoConsultaDTO, ReporteDTO, UsoConsultaDTO, type RespuestaLLM, type ReporteResponseDTO, type UsoDTO } from './chat.dtos';
import { ESQUEMA_SQLITE, EJEMPLOS_CONSULTAS } from './chat.esquema';
import { MANUAL_SISTEMA } from './chat.manual';
import { llamarLLM } from './chat.llm';
import { normalizarSQL, validarSQL } from './chat.guarda';

// --- Validacion de licencia (devuelve la licencia encontrada) ---

export async function validarLicenciaChat(clave: string, instalacionId: string) {
  const licencias = await prisma.licencia.findMany();

  let licenciaEncontrada: (typeof licencias)[number] | null = null;

  for (const lic of licencias) {
    try {
      const claveDescifrada = decrypt(lic.clave_hash);
      if (claveDescifrada === clave) {
        licenciaEncontrada = lic;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!licenciaEncontrada) {
    httpError('Licencia no encontrada', 404);
  }

  if (licenciaEncontrada!.estado !== 'activa') {
    httpError('La licencia no esta activa', 403);
  }

  const activacion = await prisma.activacion.findUnique({
    where: {
      licencia_id_instalacion_id: {
        licencia_id: licenciaEncontrada!.id,
        instalacion_id: instalacionId,
      },
    },
  });

  if (!activacion) {
    httpError('Esta instalacion no tiene una activacion valida', 403);
  }

  return licenciaEncontrada!;
}

// --- Consumo mensual (DB) ---

function periodoActual(): string {
  return new Date().toISOString().slice(0, 7); // "2026-09"
}

interface UsoChat {
  mensajes_usados: number;
  mensajes_limite: number;
}

async function obtenerLimiteChat(licenciaId: string): Promise<number> {
  // Buscar la suscripcion activa del comercio dueño de esta licencia
  const licencia = await prisma.licencia.findUnique({
    where: { id: licenciaId },
    include: {
      comercio: {
        include: {
          suscripciones: {
            where: { estado: 'ACTIVA' },
            orderBy: { inicia_en: 'desc' },
            take: 1,
            include: { plan: true },
          },
        },
      },
    },
  });

  const plan = licencia?.comercio?.suscripciones?.[0]?.plan;
  if (!plan) return env.CHAT_MENSAJES_MES;

  // 0 = ilimitado
  return plan.chat_mensajes_mes;
}

async function obtenerUso(licenciaId: string): Promise<UsoChat> {
  const periodo = periodoActual();
  const consumo = await prisma.chatConsumo.findUnique({
    where: { licencia_id_periodo: { licencia_id: licenciaId, periodo } },
  });
  const limite = await obtenerLimiteChat(licenciaId);
  return {
    mensajes_usados: consumo?.mensajes ?? 0,
    mensajes_limite: limite,
  };
}

/**
 * Incrementa el contador de mensajes SOLO si no se superó el límite.
 * Retorna el uso actualizado. Si el límite fue alcanzado, retorna null.
 */
async function incrementarMensajes(licenciaId: string): Promise<UsoChat | null> {
  const periodo = periodoActual();
  const limite = await obtenerLimiteChat(licenciaId);

  // Si limite es 0 (ilimitado), solo incrementar sin restriccion
  if (limite === 0) {
    await prisma.chatConsumo.upsert({
      where: { licencia_id_periodo: { licencia_id: licenciaId, periodo } },
      create: { licencia_id: licenciaId, periodo, mensajes: 1 },
      update: { mensajes: { increment: 1 } },
    });
    return obtenerUso(licenciaId);
  }

  // Intentar crear el registro si no existe
  await prisma.chatConsumo.upsert({
    where: { licencia_id_periodo: { licencia_id: licenciaId, periodo } },
    create: { licencia_id: licenciaId, periodo, mensajes: 0 },
    update: {},
  });

  // Incremento atómico condicional: solo si < limite
  const result = await prisma.chatConsumo.updateMany({
    where: {
      licencia_id: licenciaId,
      periodo,
      mensajes: { lt: limite },
    },
    data: { mensajes: { increment: 1 } },
  });

  if (result.count === 0) {
    return null;
  }

  return obtenerUso(licenciaId);
}

async function decrementarMensajes(licenciaId: string): Promise<void> {
  const periodo = periodoActual();
  await prisma.chatConsumo.updateMany({
    where: { licencia_id: licenciaId, periodo, mensajes: { gt: 0 } },
    data: { mensajes: { decrement: 1 } },
  });
}

export async function acumularTokens(licenciaId: string, tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): Promise<void> {
  const periodo = periodoActual();
  await prisma.chatConsumo.updateMany({
    where: { licencia_id: licenciaId, periodo },
    data: {
      prompt_tokens: { increment: BigInt(tokens.prompt_tokens) },
      completion_tokens: { increment: BigInt(tokens.completion_tokens) },
      total_tokens: { increment: BigInt(tokens.total_tokens) },
    },
  });
}

// --- Prompt del sistema ---

function construirPromptSistema(modo: 'json' | 'stream' = 'json'): string {
  // Parte comun: identidad, estilo, manual, schema
  const identidad = `Sos el asistente inteligente de un sistema POS para comercios. Tus usuarios son comerciantes sin experiencia tecnica. Ayudalos de forma clara y sencilla.`;

  const reglasComunes = `## Reglas
- Responde siempre en espanol.
- Lenguaje simple y cotidiano. NUNCA menciones terminos tecnicos: nada de "SQL", "consulta", "base de datos", "tabla", "columna", "timestamp". Deci "tu informacion", "tus datos".
- Tono calido, paciente y profesional. Sin jerga ni informalidad.
- Para datos monetarios, usa pesos argentinos con separadores de miles.
- Si no encontras informacion sobre algo en el manual, DECi que no tenes esa info en vez de inventar. No alucines funcionalidades.`;

  const manual = `## Manual de uso del sistema
${MANUAL_SISTEMA}`;

  const schema = `## Estructura de la base de datos
${ESQUEMA_SQLITE}`;

  if (modo === 'stream') {
    return `${identidad}

Estas analizando datos que el sistema ya obtuvo de la DB. Tu tarea es explicarle al comerciante los resultados en lenguaje simple.

${reglasComunes}

## Modo stream
- Respondé en TEXTO PLANO. NUNCA uses JSON, llaves, ni formato especial.
- Presenta resultados como frases naturales ("Hoy vendiste $45.000 en 12 ventas").
- Si hay mucha info, resume en lista simple.
- Si los datos no alcanzan (consulta fallida, faltan campos), empezá con @REINTENTAR {"tipo":"consulta","id_solicitud":"abc","sql":"SELECT ...","descripcion":"Breve descripcion"}

## Graficos
Al FINAL del texto, si los datos se prestan, inclui un bloque:
\`\`\`chart
{"tipo":"barra","titulo":"Ventas por dia","categorias":["Lun","Mar","Mie"],"valores":[12000,18500,15000]}
\`\`\`
Tipos: "barra", "linea", "torta". Max 12 categorias. Solo si aporta valor.

${manual}

${schema}`;
  }

  // Modo JSON (para /mensajes y /resultado)
  return `${identidad}

Tu trabajo es responder dos tipos de preguntas:

### Tipo 1: Datos del negocio
Si el usuario pregunta por numeros, reportes, stock, ventas, etc., genera una consulta SQL para obtener la respuesta.

### Tipo 2: Como usar el sistema
Si pregunta como hacer algo (crear producto, importar, abrir caja, anular venta, etc.), responde directamente con pasos claros basandote en el manual. NUNCA generes SQL para esto.

${reglasComunes}

## Reglas SQL (no las mostres al usuario)
1. Solo SELECT o WITH (lectura). NUNCA INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
2. TODA consulta DEBE incluir un LIMIT (maximo 500), incluso en agregaciones.
3. Fechas = timestamps Unix INTEGER. "Hoy": DATE(col, 'unixepoch', 'localtime') = DATE('now', 'localtime').
4. Config del sistema se consulta con SQL en tabla "config".
5. Si tenes muchos resultados, resume la info clave.

## Estilo
- Explica paso a paso con numeros.
- Para datos, presenta como frases naturales ("Hoy vendiste $45.000 en 12 ventas").
- Descripciones humanas: "Buscando tus ventas de hoy..." en vez de "Ejecutando SELECT".

## Ejemplos
Pregunta: "Como creo un producto nuevo?"
Respuesta: {tipo: "respuesta", texto: "Para crear un producto: 1. Andi a Productos. 2. Nuevo Producto. 3. Pone nombre, codigo interno (unico), codigo barras. 4. Unidad, marca, categoria. 5. Precio costo y venta. 6. Stock y minimo. 7. Guarda."}

Pregunta: "Como anulo una venta?"
Respuesta: {tipo: "respuesta", texto: "Para anular: 1. Busca la venta. 2. Anular. 3. Motivo. 4. Stock se restaura."}

Pregunta: "Cuanto vendi hoy?"
Respuesta: {tipo: "consulta", id_solicitud: "vta_hoy_01", sql: "SELECT SUM(total) AS total_hoy FROM venta WHERE estado = 'completada' AND anulada_en IS NULL AND DATE(creada_en, 'unixepoch', 'localtime') = DATE('now', 'localtime') LIMIT 1", descripcion: "Buscando tus ventas de hoy..."}

Pregunta: "Stock bajo"
Respuesta: {tipo: "consulta", id_solicitud: "stock_bajo_01", sql: "SELECT p.nombre, p.cantidad, p.stock_minimo, u.abreviatura FROM producto p JOIN unidad u ON u.id = p.unidad_id WHERE p.cantidad <= p.stock_minimo AND p.activo = 1 ORDER BY p.cantidad ASC LIMIT 50", descripcion: "Buscando productos con stock bajo..."}

Pregunta: "Cliente que mas me debe?"
Respuesta: {tipo: "consulta", id_solicitud: "deudores_01", sql: "SELECT nombre, documento, saldo_actual FROM cliente WHERE saldo_actual > 0 AND activo = 1 ORDER BY saldo_actual DESC LIMIT 10", descripcion: "Buscando clientes con deuda..."}

## Formato de respuesta
Datos del negocio: {tipo: "consulta", id_solicitud: "abc123", sql: "SELECT ...", descripcion: "Buscando tus [datos]..."}
Uso del sistema o respuesta directa: {tipo: "respuesta", texto: "Respuesta con pasos"}

${manual}

${schema}`;
}

// --- Servicio principal ---

export class ChatService {
  async preguntar(data: PreguntarDTO): Promise<RespuestaLLM> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);

    // Incremento atómico (solo si < limite)
    const usoCheck = await incrementarMensajes(lic.id);
    if (!usoCheck) {
      const limite = await obtenerLimiteChat(lic.id);
      httpError(
        `Alcanzaste tu limite mensual de ${limite} consultas del asistente. Se renueva el dia 1 del proximo mes.`,
        429,
      );
    }
    const uso = usoCheck!;

    const mensajes: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: construirPromptSistema() },
    ];

    for (const msg of data.historial.slice(-10)) {
      const rol = msg.rol === 'asistente' ? 'assistant' : msg.rol === 'sistema' ? 'system' : 'user';
      mensajes.push({ role: rol as 'user' | 'assistant' | 'system', content: msg.contenido });
    }

    mensajes.push({ role: 'user', content: data.pregunta });

    let respuesta: RespuestaLLM;
    let tokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    try {
      const resultado = await llamarLLM(mensajes);
      respuesta = resultado.respuesta;
      tokens = resultado.tokens;
    } catch (error) {
      // Si falla el LLM, devolver el crédito
      await decrementarMensajes(lic.id);
      throw error;
    }

    // Acumular tokens en DB (siempre)
    if (tokens.total_tokens > 0) {
      await acumularTokens(lic.id, tokens);
    }

    if (respuesta.tipo === 'consulta') {
      const { sql: sqlNormalizado } = normalizarSQL(respuesta.sql);
      const validacion = validarSQL(sqlNormalizado);
      if (validacion.valido) {
        return { ...respuesta, sql: sqlNormalizado, tokens, uso };
      }
      // Si sigue inválido (palabra prohibida, multi-statement): pasar al loop
      // de reintento del cliente. Nunca se ejecuta porque el guard de Rust lo rechaza.
    }

    return { ...respuesta, tokens, uso };
  }

  async resultado(data: ResultadoConsultaDTO): Promise<RespuestaLLM> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
    const mensajes = construirMensajesResultado(data);

    const { respuesta, tokens } = await llamarLLM(mensajes);

    // Acumular tokens en DB (esta llamada no incrementa mensajes, solo tokens)
    if (tokens.total_tokens > 0) {
      await acumularTokens(lic.id, tokens);
    }

    return { ...respuesta, tokens };
  }

  async reporte(data: ReporteDTO): Promise<ReporteResponseDTO> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);

    const mensajes: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: construirPromptReporte() },
      { role: 'user', content: `Aca estan los datos del negocio de hoy:\n${JSON.stringify(data.datos, null, 2)}\n\nGenera un resumen breve y calido para el comerciante.` },
    ];

    const { respuesta, tokens } = await llamarLLM(mensajes, { jsonMode: false });

    if (tokens.total_tokens > 0) {
      await acumularTokens(lic.id, tokens);
    }

    return {
      texto: respuesta.tipo === 'respuesta' ? respuesta.texto : 'No pude generar el reporte.',
      tokens: tokens.total_tokens,
    };
  }

  async uso(data: UsoConsultaDTO): Promise<UsoDTO> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
    return obtenerUso(lic.id);
  }
}

function construirPromptReporte(): string {
  return `Sos el asistente inteligente de un sistema POS para comercios. Tus usuarios son comerciantes sin experiencia tecnica.

Tu tarea es generar un resumen diario breve y amigable a partir de datos estadisticos del negocio. Explica los numeros como si le hablaras a un comerciante sin experiencia con computadoras.

Reglas:
- TEXTO PLAIN (sin JSON, sin llaves, sin bloques de codigo).
- Respuesta en 1-3 parrafos cortos o bullet points. NO mas de 200 palabras.
- Tono calido y profesional. Sin jerga tecnica.
- Analiza las tendencias: si las ventas subieron o bajaron vs ayer, mencionalo.
- Si hay alertas importantes (stock critico, vencimientos), mencionalas al final.
- Si todo esta bien, explicitalo ("Todo funciona bien, no hay alertas").
- Si los datos indican cero ventas o cero actividad, se amable y sugerí que abrió recién o que puede revisar la caja.
- Responde siempre en espanol.`;
}

export function construirMensajesResultado(data: ResultadoConsultaDTO, modo: 'json' | 'stream' = 'json'): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const mensajes: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: construirPromptSistema(modo) },
  ];

  if (data.error) {
    mensajes.push({
      role: 'assistant',
      content: JSON.stringify({ tipo: 'consulta', id_solicitud: data.id_solicitud, sql: data.sql, descripcion: 'Buscando la informacion...' }),
    });
    mensajes.push({
      role: 'user',
      content: `La consulta fallo: ${data.error}. Podes intentar con otra pregunta o explicame mejor que queres saber?`,
    });
  } else {
    const filasJson = JSON.stringify(data.filas);
    const truncado = data.recortado ? ' (resultados truncados por cantidad)' : '';
    mensajes.push({
      role: 'assistant',
      content: JSON.stringify({ tipo: 'consulta', id_solicitud: data.id_solicitud, sql: data.sql, descripcion: 'Buscando la informacion...' }),
    });
    mensajes.push({
      role: 'user',
      content: `Tus datos: (${data.filas.length} resultados${truncado}):\n${filasJson}\n\nAhora analiza estos resultados y responde al usuario en espanol, de forma simple y clara. Explica como si le hablaras a un comerciante sin experiencia con computadoras. Si hay mucha info, resume lo mas importante.`,
    });
  }

  return mensajes;
}
