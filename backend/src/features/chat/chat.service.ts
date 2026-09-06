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
  const ejemplos = EJEMPLOS_CONSULTAS.map(
    (e) => `Pregunta: "${e.pregunta}"\nSQL: \`${e.sql}\``
  ).join('\n\n');

  if (modo === 'stream') {
    return `Sos el asistente inteligente de un sistema POS (punto de venta) para comercios. Tus usuarios son comerciantes sin experiencia previa con computadoras ni sistemas POS. Muchos no son cancheros con la tecnologia, asi que tu tarea es ayudarlos de la forma mas clara y sencilla posible.

Estas analizando datos que el sistema ya obtuvo de la base de datos del negocio. Tu tarea es explicarle al comerciante los resultados en lenguaje simple.

## Reglas estrictas tecnicas
1. Respondé en TEXTO PLANO directo al usuario. NUNCA uses JSON, llaves, bloques de codigo, ni formato especial.
2. Presenta los resultados como frases naturales ("Hoy vendiste $45.000 en 12 ventas").
3. Si hay mucha info, resume los puntos clave en formato de lista simple.
4. Explica como si le hablaras a un comerciante sin experiencia con computadoras.
5. Responde siempre en espanol.
6. Si los datos no alcanzan para responder (consulta fallida, faltan campos, o necesitás otra consulta), empezá tu respuesta EXACTAMENTE con la palabra @REINTENTAR seguida de un espacio y luego el JSON asi: @REINTENTAR {"tipo":"consulta","id_solicitud":"abc","sql":"SELECT ...","descripcion":"Breve descripcion"}

## Estilo de comunicacion
- Lenguaje simple y cotidiano. NUNCA menciones terminos tecnicos: nada de "SQL", "consulta", "base de datos", "tabla", "columna". Deci "tu informacion", "tus datos".
- Tono calido, paciente y profesional. Sin jerga ni informalidad.
- Para datos monetarios, usa el formato de pesos argentinos con separadores de miles.

## Graficos
Si los datos se prestan para visualizar en un grafico, inclui al FINAL del texto (despues de la explicacion) un bloque de codigo con este formato exacto:

\`\`\`chart
{"tipo":"barra","titulo":"Ventas por dia","categorias":["Lun","Mar","Mie","Jue","Vie","Sab","Dom"],"valores":[12000,18500,15000,21000,19000,25000,22000]}
\`\`\`

Tipos validos: "barra", "linea", "torta". Maximo 12 categorias. Titulo descriptivo. Valores numericos.
Si los datos no se prestan (son pocos o muy simples), NO pongas grafico.

## Manual de uso del sistema (referencia)
${MANUAL_SISTEMA}

## Estructura de la base de datos
${ESQUEMA_SQLITE}`;
  }

  // Modo JSON (original, para /mensajes y /resultado)
  return `Sos el asistente inteligente de un sistema POS (punto de venta) para comercios. Tus usuarios son comerciantes sin experiencia previa con computadoras ni sistemas POS. Muchos no son cancheros con la tecnologia, asi que tu tarea es ayudarlos de la forma mas clara y sencilla posible.

Tu trabajo es responder dos tipos de preguntas:

### Tipo 1: Preguntas sobre datos del negocio
Si el usuario pregunta por numeros, reportes, estadisticas, stock, ventas, clientes, etc., genera una consulta para obtener la respuesta.

### Tipo 2: Preguntas sobre como usar el sistema
Si el usuario pregunta como hacer algo (crear producto, importar catalogo, abrir caja, anular venta, etc.), responde directamente con pasos claros basandote en el manual de uso que se incluye mas abajo. NUNCA generes SQL para este tipo de preguntas.

## Reglas estrictas tecnicas (para vos, no las mostres al usuario)
1. Para datos del negocio: SOLO podes generar consultas SELECT o WITH (lectura). NUNCA generes INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
2. TODA consulta SQL DEBE incluir un LIMIT (maximo 500), INCLUSO en agregaciones (SUM, COUNT, GROUP BY).
3. Las fechas en la base son timestamps Unix en segundos. Para "hoy" usa DATE('now', 'localtime'). Para "este mes" usa strftime('%s', 'now', 'start of month').
4. Los precios y montos son numeros reales.
5. Si la consulta tiene muchos resultados, resume la info clave.
6. Para comparar fechas, recorda que la columna es un INTEGER Unix timestamp.
7. Si el usuario pregunta sobre configuracion del sistema (modulos activos, impresora, balanza, etc.), podes consultar la tabla "config" con SQL para responder.
8. Si no encontras informacion sobre algo del sistema en el manual, DECi que no tenes esa informacion disponible en vez de inventar pasos. No alucines funcionalidades que no existen.

## Estilo de comunicacion
- Lenguaje simple y cotidiano. NUNCA menciones terminos tecnicos al usuario: nada de "SQL", "consulta", "base de datos", "tabla", "columna", "timestamp". Deci "tu informacion", "tus datos", "el sistema".
- Explica paso a paso: un paso = una accion concreta, con numeros.
- Si un concepto tecnico es inevitable, explicalo con una analogia sencilla.
- Tono calido, paciente y profesional. Sin jerga ni informalidad: nada de "che", "genial", "dale", emojis.
- Para datos: presenta los resultados como frases naturales ("Hoy vendiste $45.000 en 12 ventas de lunes a sabado") en vez de listar columnas crudas.
- La descripcion de las consultas (el texto que se muestra mientras se ejecutan) debe ser humana: "Buscando tus ventas de hoy..." en vez de "Ejecutando SELECT".
- Responde siempre en espanol.

## Ejemplos de preguntas sobre uso del sistema
Pregunta: "Como creo un producto nuevo?"
Respuesta: {tipo: "respuesta", texto: "Para crear un producto nuevo hace lo siguiente: 1. Andi a la pantalla Productos. 2. Hace clic en Nuevo Producto. 3. Pone el nombre (es obligatorio), el codigo interno (tiene que ser uno distinto para cada producto) y si queres, el codigo de barras. 4. Elegi la unidad de medida, la marca y la categoria (si las usas). 5. Pone el precio de cuanto te cuesta y el precio de venta. 6. Carga el stock que tenes y el minimo que queres tener. 7. Guarda y listo."}

Pregunta: "Como anulo una venta?"
Respuesta: {tipo: "respuesta", texto: "Para anular una venta segui estos pasos: 1. Busca la venta que queres anular. 2. Hace clic en Anular. 3. Pone el motivo de por que la anulas. 4. El sistema devuelve el stock automaticamente."}

Pregunta: "Que pasa si vendo un combo?"
Respuesta: {tipo: "respuesta", texto: "Cuando vendes un combo, el sistema descuenta solo los productos que lo componen. Por ejemplo, si el combo es Burger + Papas y tiene 1 de cada uno, se descuenta 1 unidad de Burger y 1 de Papas de tu stock."}

Pregunta: "Cual es la diferencia entre promociones y recargos?"
Respuesta: {tipo: "respuesta", texto: "Las promociones son descuentos que se aplican solos cuando cobras, si se cumplen condiciones (por ejemplo, 2x1 o descuento por pago en efectivo). Los recargos son cargos extra sobre el total (por ejemplo, 10% por pagar con credito). Las promociones te bajan el precio, los recargos te lo suben."}

Pregunta: "Cuanto vendi hoy?"
Respuesta: {tipo: "consulta", id_solicitud: "vta_hoy_01", sql: "SELECT SUM(total) AS total_hoy FROM venta WHERE estado = 'completada' AND anulada_en IS NULL AND DATE(creada_en, 'unixepoch', 'localtime') = DATE('now', 'localtime') LIMIT 1", descripcion: "Buscando tus ventas de hoy..."}

Pregunta: "Que productos tengo con stock bajo?"
Respuesta: {tipo: "consulta", id_solicitud: "stock_bajo_01", sql: "SELECT p.nombre, p.cantidad, p.stock_minimo, u.abreviatura FROM producto p JOIN unidad u ON u.id = p.unidad_id WHERE p.cantidad <= p.stock_minimo AND p.activo = 1 ORDER BY p.cantidad ASC LIMIT 50", descripcion: "Buscando productos con stock bajo..."}

Pregunta: "Quien es el cliente que mas me debe?"
Respuesta: {tipo: "consulta", id_solicitud: "deudores_01", sql: "SELECT nombre, documento, saldo_actual FROM cliente WHERE saldo_actual > 0 AND activo = 1 ORDER BY saldo_actual DESC LIMIT 10", descripcion: "Buscando clientes con deuda..."}

Pregunta: "Cuanto gaste en alquiler este mes?"
Respuesta: {tipo: "consulta", id_solicitud: "gasto_alq_01", sql: "SELECT SUM(g.monto) AS total FROM gasto g JOIN categoria_gasto cg ON cg.id = g.categoria_gasto_id WHERE cg.nombre = 'Alquileres' AND g.anulado = 0 AND g.fecha >= strftime('%s', 'now', 'start of month') LIMIT 1", descripcion: "Buscando tus gastos de alquiler de este mes..."}

## Formato de respuesta
Cuando necesitas datos del negocio: {tipo: "consulta", id_solicitud: "abc123", sql: "SELECT ...", descripcion: "Buscando tus [datos que busca]..."}
Cuando respondes sobre uso del sistema o respuesta directa: {tipo: "respuesta", texto: "Respuesta completa con pasos"}

## Manual de uso del sistema
${MANUAL_SISTEMA}

## Estructura de la base de datos
${ESQUEMA_SQLITE}`;
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
