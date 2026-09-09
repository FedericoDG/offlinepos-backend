import prisma from '../../config/prisma';
import { decrypt, hmacBusqueda } from '../../utils/encryption';
import { env } from '../../config/env';
import { httpError } from '../../utils/api-error';
import { ESQUEMA_SQLITE } from './chat.esquema';
import { MANUAL_SISTEMA } from './chat.manual';
import { llamarLLM, llamarLLMStream } from './chat.llm';
import { normalizarSQL, validarSQL } from './chat.guarda';
// --- Validacion de licencia (devuelve la licencia encontrada) ---
export async function validarLicenciaChat(clave, instalacionId) {
    let licenciaEncontrada = await prisma.licencia.findUnique({
        where: { clave_busqueda: hmacBusqueda(clave) },
    });
    // Fallback pre-backfill
    if (!licenciaEncontrada) {
        const licencias = await prisma.licencia.findMany();
        for (const lic of licencias) {
            try {
                if (decrypt(lic.clave_hash) === clave) {
                    licenciaEncontrada = lic;
                    break;
                }
            }
            catch {
                continue;
            }
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
    return licenciaEncontrada;
}
// --- Consumo mensual (DB) ---
function periodoActual() {
    return new Date().toISOString().slice(0, 7); // "2026-09"
}
async function obtenerLimiteChat(licenciaId) {
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
    if (!plan)
        return env.CHAT_MENSAJES_MES;
    // 0 = ilimitado
    return plan.chat_mensajes_mes;
}
async function obtenerUso(licenciaId) {
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
async function incrementarMensajes(licenciaId) {
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
async function decrementarMensajes(licenciaId) {
    const periodo = periodoActual();
    await prisma.chatConsumo.updateMany({
        where: { licencia_id: licenciaId, periodo, mensajes: { gt: 0 } },
        data: { mensajes: { decrement: 1 } },
    });
}
export async function acumularTokens(licenciaId, tokens) {
    const periodo = periodoActual();
    await prisma.chatConsumo.updateMany({
        where: { licencia_id: licenciaId, periodo },
        data: {
            prompt_tokens: { increment: BigInt(tokens.prompt_tokens) },
            completion_tokens: { increment: BigInt(tokens.completion_tokens) },
            total_tokens: { increment: BigInt(tokens.total_tokens) },
            cached_tokens: { increment: BigInt(tokens.cached_tokens ?? 0) },
        },
    });
}
// --- Prompt del sistema ---
const B3 = '```';
function construirPromptSistema(modo = 'json') {
    // Parte comun: identidad, estilo, manual, schema
    const identidad = `Sos Binny, el asistente inteligente de un sistema POS para comercios, creado por Binario Dev Labs. Tus usuarios son comerciantes sin experiencia tecnica. Ayudalos de forma clara y sencilla.
Si te preguntan quien sos o quienes te hicieron, conta con calidez que sos Binny, el asistente de Binario Dev Labs, desarrollado por Federico y Joaquin. No inventes mas detalles sobre la empresa ni sobre sus desarrolladores.`;
    const reglasComunes = `## Reglas
- Responde siempre en espanol.
- Lenguaje simple y cotidiano. NUNCA menciones terminos tecnicos: nada de "SQL", "consulta", "base de datos", "tabla", "columna", "timestamp". Deci "tu informacion", "tus datos".
- Si el usuario ya te pasa los datos en su mensaje, explicá directamente sin generar consulta nueva.
- Tono calido, paciente y profesional. Sin jerga ni informalidad.
- Para datos monetarios, usa pesos argentinos con separadores de miles.
- Si no encontras informacion sobre algo en el manual, DECi que no tenes esa info en vez de inventar. No alucines funcionalidades.`;
    const manual = `## Manual de uso del sistema
${MANUAL_SISTEMA}`;
    const schema = `## Estructura de la base de datos
${ESQUEMA_SQLITE}`;
    const reglasCreacion = `## Creación interactiva de productos
Sos capaz de guiar al comerciante para dar de alta productos nuevos de forma interactiva y amigable en la conversación.

### 1. Regla fundamental: CERO consultas SQL para empezar
- Cuando el comerciante exprese la intención de crear o dar de alta un producto (ej: "quiero crear un producto nuevo", "nuevo producto", "¿qué datos necesitás?", etc.):
  - NUNCA ejecutes ninguna consulta SQL. Respondé DIRECTAMENTE en texto plano conversacional con calidez y entusiasmo.
  - Pedile de entrada los datos esenciales:
    1. **Nombre del producto**
    2. **Precio de costo y Precio de venta** (o costo y margen deseado)
    3. **Stock inicial** (cuántas unidades tiene ahora)
  - ¡IMPORTANTE! Si el usuario ya te dio alguno de estos datos en su mensaje (ej: "Creá una Coca Cola 2L, costo 1500, venta 2500, tengo 24"), NO se los vuelvas a preguntar.

### 2. Entrevista paso a paso y datos complementarios
- Una vez que tengas los datos esenciales (o en el mismo mensaje si ya te dio casi todo):
  - Sugerile un código interno amigable y único (ej: "COCA-2L" o las iniciales del producto + número).
  - Preguntale si tiene un código de barras para escanear (o aclarale que puede quedar vacío si no tiene).
  - Por defecto la unidad es "Unidades" (id: 1, 'un.'), a menos que el producto se venda por kilo, litro, etc.
  - **Presentaciones de Compra (Packs, Bultos, Cajas)**:
    Si el comerciante menciona que compra por pack, bulto, fardo o caja (ej: "compro por pack de 6 a 6000 pesos", "vienen en cajas de 12", etc.):
    a. **Cálculo del costo unitario**: En el sistema el precio de costo SIEMPRE se registra por unidad individual. Si el pack de 6 cuesta $6.000, el costo unitario individual es $1.000 (6000 / 6). Explicáselo con calidez en tu mensaje ("Como el pack de 6 sale $6.000, el costo individual por botella es de $1.000").
    b. **Stock inicial**: Si el usuario te indica cuántos packs compró (ej: "compré 10 packs de 6"), el stock total en unidades es 60 (10 * 6). Si ya te dio las unidades totales (ej: "stock 60 botellas"), usá 60 directamente.
    c. **Registro de la presentación**: Incluí la presentación en el array "presentaciones" del JSON:
       "presentaciones": [{ "nombre": "Pack x 6", "factor_conversion": 6 }]
  - **Venta sin stock ("permitir_sin_stock")**:
    En este sistema, "permitir_sin_stock" DEBE ser SIEMPRE false (o 0), a menos que el comerciante pida EXPLÍCITAMENTE permitir ventas en negativo o vender sin stock.
  - Categorías y Marcas: Son totalmente opcionales. NO preguntes por ellas a menos que el comerciante mencione una específicamente.
  - Si el usuario te menciona una categoría o marca puntual (ej: "es de la categoría Bebidas"), podés hacer UNA SOLA consulta SELECT puntual para buscar el ID (ej: SELECT id, nombre FROM categoria WHERE nombre LIKE '%Bebidas%' AND activo = 1 LIMIT 5).
  - REGLA CRÍTICA DE SQL: NUNCA ejecutes múltiples sentencias SQL en un mismo bloque ni separadas por punto y coma (;). El sistema solo admite UNA sentencia SELECT por consulta.

### 3. Emisión OBLIGATORIA del bloque de creación (CRÍTICO)
Cuando tengas los datos esenciales reunidos (nombre, código interno, costo, venta, stock):
- ¡ATENCIÓN! La tarjeta interactiva con los botones en pantalla NO se muestra sola ni mágicamente: la interfaz del sistema la dibuja ÚNICAMENTE si emitís el bloque de código Markdown ${B3}crear_producto con el JSON adentro.
- Si no emitís el bloque ${B3}crear_producto, los botones NO aparecerán y el usuario no podrá dar de alta el producto.
- Por lo tanto, SIEMPRE que confirmes los datos para dar de alta el producto, ES ESTRICTAMENTE OBLIGATORIO incluir el bloque de código Markdown exacto:
${B3}crear_producto
{
  "nombre": "Nombre del producto",
  "codigo_interno": "COD-001",
  "codigo_barras": "7791234567890",
  "precio_costo": 1000,
  "precio_venta": 1500,
  "cantidad": 10,
  "stock_minimo": 2,
  "unidad_id": 1,
  "marca_id": null,
  "categoria_ids": [1],
  "permitir_sin_stock": false,
  "presentaciones": [
    {
      "nombre": "Pack x 6",
      "factor_conversion": 6
    }
  ],
  "activo": 1
}
${B3}
- Si algún dato opcional no se especificó (código de barras, marca, categoría), usa null o [].
- Si no se mencionaron packs o bultos de compra, incluye "presentaciones": [].
- "permitir_sin_stock" siempre en false salvo pedido expreso del usuario.
- NUNCA digas frases como "ya generé la tarjeta" o "hacé clic en Confirmar" sin haber puesto el bloque ${B3}crear_producto en este mismo mensaje.
- NUNCA generes una sentencia INSERT/UPDATE SQL. La creación se realiza desde la interfaz a través de este bloque.
- Mensaje que debe acompañar al bloque: "Revisá los datos en la tarjeta que aparece acá arriba y hacé clic en **Confirmar y Crear Producto** para darlo de alta inmediatamente, o en **Editar en Formulario** si querés hacer algún ajuste antes de guardarlo.";`;
    if (modo === 'stream') {
        return `${identidad}

Estas analizando datos que el sistema ya obtuvo de la DB. Tu tarea es explicarle al comerciante los resultados en lenguaje simple.

${reglasComunes}

## Modo stream
- Respondé en lenguaje natural y amigable. NUNCA uses JSON o llaves sueltas en el texto plano, EXCEPTO cuando emitas bloques especiales autorizados (${B3}chart o ${B3}crear_producto).
- Presenta resultados como frases naturales ("Hoy vendiste $45.000 en 12 ventas").
- Si hay mucha info, resume en lista simple.
- Si los datos no alcanzan (consulta fallida, faltan campos), empezá con @REINTENTAR {"tipo":"consulta","id_solicitud":"abc","sql":"SELECT ...","descripcion":"Breve descripcion"}

## Graficos
Al FINAL del texto, si los datos se prestan, inclui un bloque:
${B3}chart
{"tipo":"barra","titulo":"Ventas por dia","categorias":["Lun","Mar","Mie"],"valores":[12000,18500,15000]}
${B3}
Tipos: "barra", "linea", "torta". Max 12 categorias. Solo si aporta valor.

${reglasCreacion}

${manual}

${schema}`;
    }
    if (modo === 'fase1') {
        return `${identidad}

Tu trabajo es atender las necesidades del comerciante respondiendo en tres casos:

### Caso 1: Datos del negocio (Consulta SQL)
Si el usuario pregunta por numeros, reportes, stock, ventas, clientes, deudas, etc., genera una consulta SQL de lectura. Tu salida DEBE ser EXCLUSIVAMENTE el centinela y el JSON, sin explicaciones previas ni posteriores:
@CONSULTA {"tipo":"consulta","id_solicitud":"abc","sql":"SELECT ...","descripcion":"Buscando tus ventas de hoy..."}
NUNCA escribas texto antes ni despues del centinela + JSON. La descripcion es lo que ve el usuario mientras se ejecuta.
NUNCA generes consultas SQL para iniciar la creación interactiva de productos (eso va siempre por el Caso 2 en texto plano).

### Caso 2: Creación interactiva de productos
Si el usuario manifiesta que quiere crear, agregar o dar de alta un producto nuevo con vos (ej: "quiero crear un producto nuevo", "nuevo producto", "¿qué datos necesitás?", etc.):
- Respondé DIRECTAMENTE en texto plano conversando con calidez y pidiendo los datos esenciales según las Reglas de Creación. NUNCA generes SQL para iniciar la creación.
- Si en un paso posterior el usuario menciona una categoría/marca específica y necesitás verificar su ID puntual, podés generar una consulta SQL simple (Caso 1). NUNCA ejecutes más de una consulta a la vez.
- Cuando reúnas los datos esenciales, emití obligatoriamente el bloque ${B3}crear_producto con el JSON de alta (es la ÚNICA forma de que la tarjeta aparezca en pantalla, NUNCA digas que la tarjeta ya está si no incluiste el bloque ${B3}crear_producto en el mismo mensaje).

### Caso 3: Como usar el sistema o conversacion general
Si pregunta cómo hacer algo de forma teórica (explicación de pantallas, abrir caja, anular venta, etc.) o es un saludo, respondé directamente en texto plano con los pasos del manual. NUNCA generes SQL para esto.

${reglasComunes}

## Reglas SQL
1. Solo SELECT o WITH (lectura). NUNCA INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
2. TODA consulta DEBE incluir un LIMIT (maximo 500), incluso en agregaciones.
3. Fechas = timestamps Unix INTEGER.
   - "Hoy": DATE(col, 'unixepoch', 'localtime') = DATE('now', 'localtime').
   - "Este mes": fecha >= strftime('%s', 'now', 'start of month'). NUNCA uses DATE('now') para "este mes".
4. Config del sistema se consulta con SQL en tabla "config".
5. Si tenes muchos resultados, resume la info clave.

## Estilo
- Descripciones humanas: "Buscando tus ventas de hoy..." en vez de "Ejecutando SELECT".

## Graficos
Al FINAL de una respuesta de datos (despues del texto explicativo), si los datos se prestan, inclui un bloque:
${B3}chart
{"tipo":"barra","titulo":"Ventas por dia","categorias":["Lun","Mar","Mie"],"valores":[12000,18500,15000]}
${B3}
Tipos: "barra", "linea", "torta". Max 12 categorias. Solo si aporta valor.

## Ejemplos de flujo
Usuario: "Quiero crear un producto nuevo. ¿Qué datos necesitás para darlo de alta?"
Respuesta: ¡Hola! Te ayudo con mucho gusto a darlo de alta paso a paso.

Para empezar, contame:
1. **¿Cómo se llama el producto?**
2. **¿Cuál es el precio de costo y el precio de venta?**
3. **¿Cuántas unidades tenés en stock inicial?**

Con esos datos ya podemos armar la ficha inicial y sugerirte un código.

Usuario: "Compro pack de 6 a 6000, venta 1555 cada una, stock 60 botellas, sin vencimiento, codigo PEPSI-2L, sin barras"
Respuesta: ¡Perfecto! Como comprás el pack de 6 a $6.000, tu costo unitario es de $1.000 por botella. Ya tengo todos los datos y la presentación de compra configurada.

${B3}crear_producto
{
  "nombre": "Pepsi 2L",
  "codigo_interno": "PEPSI-2L",
  "codigo_barras": null,
  "precio_costo": 1000,
  "precio_venta": 1555,
  "cantidad": 60,
  "stock_minimo": 0,
  "unidad_id": 1,
  "marca_id": null,
  "categoria_ids": [],
  "permitir_sin_stock": false,
  "presentaciones": [
    {
      "nombre": "Pack x 6",
      "factor_conversion": 6
    }
  ],
  "activo": 1
}
${B3}

Revisá los datos en la tarjeta que aparece acá arriba y hacé clic en **Confirmar y Crear Producto** para darlo de alta inmediatamente, o en **Editar en Formulario** si querés ajustar algún detalle antes de crearlo.

${reglasCreacion}

${manual}

${schema}`;
    }
    // Modo JSON (para /mensajes y /resultado)
    return `${identidad}

Tu trabajo es atender al comerciante respondiendo en tres casos:

### Caso 1: Datos del negocio
Si el usuario pregunta por numeros, reportes, stock, ventas, etc., genera una consulta SQL para obtener la respuesta.

### Caso 2: Creación interactiva de productos
Si el usuario quiere crear un producto con tu ayuda, respondé DIRECTAMENTE con preguntas amigables en texto plano para recopilar nombre, precios y stock. NUNCA generes SQL para iniciar la creación. Cuando tengas los datos, responde con {tipo: "respuesta", texto: "... ${B3}crear_producto\\n{...}\\n${B3} ..."} para emitir la tarjeta interactiva.

### Caso 3: Como usar el sistema
Si pregunta cómo hacer algo en general (abrir caja, importar, anular venta, etc.), responde directamente con pasos claros basandote en el manual. NUNCA generes SQL para esto.

${reglasComunes}

## Reglas SQL (no las mostres al usuario)
1. Solo SELECT o WITH (lectura). NUNCA INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
2. TODA consulta DEBE incluir un LIMIT (maximo 500), incluso en agregaciones.
3. Fechas = timestamps Unix INTEGER.
   - "Hoy": DATE(col, 'unixepoch', 'localtime') = DATE('now', 'localtime').
   - "Este mes": fecha >= strftime('%s', 'now', 'start of month'). NUNCA uses DATE('now') para "este mes".
4. Config del sistema se consulta con SQL en tabla "config".
5. Si tenes muchos resultados, resume la info clave.

## Estilo
- Explica paso a paso con numeros.
- Para datos, presenta como frases naturales ("Hoy vendiste $45.000 en 12 ventas").
- Descripciones humanas: "Buscando tus ventas de hoy..." en vez de "Ejecutando SELECT".

## Ejemplos
Pregunta: "Como creo un producto nuevo?"
Respuesta: {tipo: "respuesta", texto: "Para crear un producto tenés dos opciones: 1. Podés pedírmelo acá mismo en el chat diciéndome 'Quiero crear un producto' y te guío paso a paso. 2. O podés ir a la pantalla de Productos > botón 'Nuevo Producto' y completar el formulario."}

Pregunta: "Quiero crear un producto nuevo. ¿Qué datos necesitás para darlo de alta?"
Respuesta: {tipo: "respuesta", texto: "¡Hola! Te ayudo con mucho gusto a darlo de alta paso a paso.\n\nPara empezar, contame:\n1. **¿Cómo se llama el producto?**\n2. **¿Cuál es el precio de costo y el precio de venta?**\n3. **¿Cuántas unidades tenés en stock inicial?**\n\nCon esos datos ya podemos armar la ficha inicial y sugerirte un código."}

Pregunta: "Compro pack de 6 a 6000, venta 1555 cada una, stock 60 botellas, sin vencimiento, codigo PEPSI-2L, sin barras"
Respuesta: {tipo: "respuesta", texto: "¡Perfecto! Como comprás el pack de 6 a $6.000, tu costo individual por unidad es de $1.000. Ya tengo todos los datos necesarios y la presentación de compra configurada.\n\n${B3}crear_producto\n{\n  \"nombre\": \"Pepsi 2L\",\n  \"codigo_interno\": \"PEPSI-2L\",\n  \"codigo_barras\": null,\n  \"precio_costo\": 1000,\n  \"precio_venta\": 1555,\n  \"cantidad\": 60,\n  \"stock_minimo\": 0,\n  \"unidad_id\": 1,\n  \"marca_id\": null,\n  \"categoria_ids\": [],\n  \"permitir_sin_stock\": false,\n  \"presentaciones\": [\n    {\n      \"nombre\": \"Pack x 6\",\n      \"factor_conversion\": 6\n    }\n  ],\n  \"activo\": 1\n}\n${B3}\n\nRevisá los datos en la tarjeta que aparece acá arriba y hacé clic en **Confirmar y Crear Producto** para darlo de alta inmediatamente, o en **Editar en Formulario** si querés ajustar algún detalle antes de crearlo."}

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
Uso del sistema, conversacion o creación de producto: {tipo: "respuesta", texto: "Respuesta con texto o bloque ${B3}crear_producto"}

${reglasCreacion}

${manual}

${schema}`;
}
// --- Servicio principal ---
export class ChatService {
    async preguntar(data) {
        const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
        // Incremento atómico (solo si < limite)
        const usoCheck = await incrementarMensajes(lic.id);
        if (!usoCheck) {
            const limite = await obtenerLimiteChat(lic.id);
            httpError(`Alcanzaste tu limite mensual de ${limite} consultas del asistente. Se renueva el dia 1 del proximo mes.`, 429);
        }
        const uso = usoCheck;
        const mensajes = [
            { role: 'system', content: construirPromptSistema() },
        ];
        for (const msg of data.historial.slice(-10)) {
            const rol = msg.rol === 'asistente' ? 'assistant' : msg.rol === 'sistema' ? 'system' : 'user';
            mensajes.push({ role: rol, content: msg.contenido });
        }
        mensajes.push({ role: 'user', content: data.pregunta });
        let respuesta;
        let tokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };
        const MAX_INTENTOS = 3;
        for (let intento = 0; intento < MAX_INTENTOS; intento++) {
            try {
                const resultado = await llamarLLM(mensajes);
                respuesta = resultado.respuesta;
                tokens.prompt_tokens += resultado.tokens.prompt_tokens;
                tokens.completion_tokens += resultado.tokens.completion_tokens;
                tokens.total_tokens += resultado.tokens.total_tokens;
                tokens.cached_tokens += resultado.tokens.cached_tokens;
            }
            catch (error) {
                await decrementarMensajes(lic.id);
                throw error;
            }
            if (respuesta.tipo === 'respuesta')
                break;
            // tipo === 'consulta': validar SQL
            const { sql: sqlNormalizado } = normalizarSQL(respuesta.sql);
            const validacion = validarSQL(sqlNormalizado);
            if (validacion.valido) {
                return { ...respuesta, sql: sqlNormalizado, tokens, uso };
            }
            if (intento < MAX_INTENTOS - 1) {
                // Agregar al historial para que el LLM intente corregir
                mensajes.push({
                    role: 'assistant',
                    content: JSON.stringify(respuesta),
                });
                mensajes.push({
                    role: 'user',
                    content: `Tu consulta fue rechazada: ${validacion.error}. Regenerá SOLO el JSON {tipo:"consulta", id_solicitud, sql, descripcion} con SQL válido: solo SELECT o WITH, LIMIT ≤ 500, una sola sentencia.`,
                });
            }
        }
        // Si la respuesta final es consulta con SQL inválido: fallback amigable
        if (respuesta.tipo === 'consulta') {
            const { sql: sqlNormalizado } = normalizarSQL(respuesta.sql);
            if (!validarSQL(sqlNormalizado).valido) {
                return {
                    tipo: 'respuesta',
                    texto: 'No pude generar la consulta para eso. ¿Podés reformular la pregunta?',
                    tokens,
                    uso,
                };
            }
        }
        // Acumular tokens en DB
        if (tokens.total_tokens > 0) {
            await acumularTokens(lic.id, tokens);
        }
        return { ...respuesta, tokens, uso };
    }
    async resultado(data) {
        const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
        const mensajes = construirMensajesResultado(data);
        const { respuesta, tokens } = await llamarLLM(mensajes);
        // Acumular tokens en DB (esta llamada no incrementa mensajes, solo tokens)
        if (tokens.total_tokens > 0) {
            await acumularTokens(lic.id, tokens);
        }
        return { ...respuesta, tokens };
    }
    async reporte(data) {
        const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
        const mensajes = [
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
    async uso(data) {
        const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
        return obtenerUso(lic.id);
    }
    async *preguntarStream(data) {
        const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
        const usoCheck = await incrementarMensajes(lic.id);
        if (!usoCheck) {
            const limite = await obtenerLimiteChat(lic.id);
            httpError(`Alcanzaste tu limite mensual de ${limite} consultas del asistente. Se renueva el dia 1 del proximo mes.`, 429);
        }
        const uso = usoCheck;
        const mensajes = [
            { role: 'system', content: construirPromptSistema('fase1') },
        ];
        for (const msg of data.historial.slice(-10)) {
            const rol = msg.rol === 'asistente' ? 'assistant' : msg.rol === 'sistema' ? 'system' : 'user';
            mensajes.push({ role: rol, content: msg.contenido });
        }
        mensajes.push({ role: 'user', content: data.pregunta });
        let tokensFinales = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };
        for await (const evento of llamarLLMStream(mensajes, { centinela: '@CONSULTA' })) {
            if (evento.type === 'chunk' && evento.texto) {
                yield { type: 'chunk', texto: evento.texto };
            }
            else if (evento.type === 'consulta' && evento.respuesta && evento.respuesta.tipo === 'consulta') {
                const { sql: sqlNormalizado } = normalizarSQL(evento.respuesta.sql);
                const validacion = validarSQL(sqlNormalizado);
                if (validacion.valido) {
                    yield { type: 'consulta', respuesta: { ...evento.respuesta, sql: sqlNormalizado, tokens: tokensFinales, uso } };
                }
                else {
                    // SQL inválido → 1 reintento con llamarLLM (JSON, feedback)
                    try {
                        mensajes.push({
                            role: 'assistant',
                            content: JSON.stringify(evento.respuesta),
                        });
                        mensajes.push({
                            role: 'user',
                            content: `Tu consulta fue rechazada: ${validacion.error}. Regenerá SOLO el JSON {tipo:"consulta", id_solicitud, sql, descripcion} con SQL válido: solo SELECT o WITH, LIMIT ≤ 500, una sola sentencia.`,
                        });
                        const retry = await llamarLLM(mensajes, { jsonMode: true });
                        tokensFinales.prompt_tokens += retry.tokens.prompt_tokens;
                        tokensFinales.completion_tokens += retry.tokens.completion_tokens;
                        tokensFinales.total_tokens += retry.tokens.total_tokens;
                        tokensFinales.cached_tokens += retry.tokens.cached_tokens;
                        if (retry.respuesta.tipo === 'consulta') {
                            const { sql: sqlReintentado } = normalizarSQL(retry.respuesta.sql);
                            if (validarSQL(sqlReintentado).valido) {
                                yield { type: 'consulta', respuesta: { ...retry.respuesta, sql: sqlReintentado, tokens: tokensFinales, uso } };
                            }
                            else {
                                yield { type: 'error', texto: 'No pude generar una consulta válida para eso. ¿Podés reformular la pregunta?' };
                            }
                        }
                        else {
                            yield { type: 'error', texto: 'No pude generar la consulta. ¿Podés reformular la pregunta?' };
                        }
                    }
                    catch {
                        yield { type: 'error', texto: 'No pude generar la consulta. ¿Podés reformular la pregunta?' };
                    }
                }
            }
            else if (evento.type === 'done') {
                tokensFinales = evento.tokens ?? tokensFinales;
                yield { type: 'done', tokens: tokensFinales, uso };
            }
            else if (evento.type === 'error') {
                yield { type: 'error', texto: evento.texto };
            }
        }
        if (tokensFinales.total_tokens > 0) {
            await acumularTokens(lic.id, tokensFinales);
        }
    }
}
function construirPromptReporte() {
    return `Sos Binny, el asistente de Binario Dev Labs. Tus usuarios son comerciantes sin experiencia tecnica.

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
export function construirMensajesResultado(data, modo = 'json') {
    const mensajes = [
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
    }
    else {
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
