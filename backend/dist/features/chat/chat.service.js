import prisma from '../../config/prisma';
import { decrypt, hmacBusqueda } from '../../utils/encryption';
import { env } from '../../config/env';
import { httpError } from '../../utils/api-error';
import { ESQUEMA_SQLITE } from './chat.esquema';
import { MANUAL_SISTEMA } from './chat.manual';
import { llamarLLM, llamarLLMStream, llamarLLMVision } from './chat.llm';
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
async function incrementarMensajes(licenciaId, cantidad = 1) {
    const periodo = periodoActual();
    const limite = await obtenerLimiteChat(licenciaId);
    // Si limite es 0 (ilimitado), solo incrementar sin restriccion
    if (limite === 0) {
        await prisma.chatConsumo.upsert({
            where: { licencia_id_periodo: { licencia_id: licenciaId, periodo } },
            create: { licencia_id: licenciaId, periodo, mensajes: cantidad },
            update: { mensajes: { increment: cantidad } },
        });
        return obtenerUso(licenciaId);
    }
    // Intentar crear el registro si no existe
    await prisma.chatConsumo.upsert({
        where: { licencia_id_periodo: { licencia_id: licenciaId, periodo } },
        create: { licencia_id: licenciaId, periodo, mensajes: 0 },
        update: {},
    });
    // Incremento atómico condicional: solo si mensajes + cantidad <= limite
    const result = await prisma.chatConsumo.updateMany({
        where: {
            licencia_id: licenciaId,
            periodo,
            mensajes: { lte: limite - cantidad },
        },
        data: { mensajes: { increment: cantidad } },
    });
    if (result.count === 0) {
        return null;
    }
    return obtenerUso(licenciaId);
}
async function decrementarMensajes(licenciaId, cantidad = 1) {
    const periodo = periodoActual();
    await prisma.chatConsumo.updateMany({
        where: { licencia_id: licenciaId, periodo, mensajes: { gte: cantidad } },
        data: { mensajes: { decrement: cantidad } },
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
function construirPromptSistema(modo = 'json', contexto) {
    // Parte comun: identidad, estilo, manual, schema
    const identidad = `Sos Binny, el asistente inteligente de un sistema POS para comercios, creado por Binario Dev Labs. Tus usuarios son comerciantes sin experiencia tecnica. Ayudalos de forma clara y sencilla.
Si te preguntan quien sos o quienes te hicieron, conta con calidez que sos Binny, el asistente de Binario Dev Labs, desarrollado por Federico y Joaquin. No inventes mas detalles sobre la empresa ni sobre sus desarrolladores.`;
    const usarIva = contexto?.usar_iva ?? false;
    const alicuotaPred = contexto?.alicuota_predeterminada ?? { id: 1, porcentaje: 21, nombre: 'IVA General 21%' };
    const alicuotasTexto = contexto?.alicuotas?.map(a => `${a.porcentaje}% (${a.nombre}, id: ${a.id}${a.predeterminada ? ' - por defecto' : ''})`).join(', ') ?? '21% (IVA General 21%, id: 1)';
    const fechaActual = contexto?.fecha_actual;
    const horaActual = contexto?.hora_actual;
    const diaSemana = contexto?.dia_semana;
    const referenciaTemporal = fechaActual && horaActual
        ? `\n\n## Referencia Temporal Local del Comercio
Hoy es ${diaSemana || 'hoy'}, ${fechaActual} y la hora local actual es ${horaActual} hs.
Usa esta fecha y hora como punto de partida exacto para calcular cualquier referencia temporal relativa que te pida el comerciante (ej: "mañana", "en 30 minutos", "el próximo viernes a las 10:00", etc.).`
        : '';
    const reglasComunes = `## Reglas
- Responde siempre en espanol.
- Lenguaje simple y cotidiano. NUNCA menciones terminos tecnicos: nada de "SQL", "consulta", "base de datos", "tabla", "columna", "timestamp". Deci "tu informacion", "tus datos".
- Si el usuario ya te pasa los datos en su mensaje, explicá directamente sin generar consulta nueva.
- Tono calido, paciente y profesional. Sin jerga ni informalidad.
- Para datos monetarios, usa pesos argentinos con separadores de miles.
- Si no encontras informacion sobre algo en el manual, DECi que no tenes esa info en vez de inventar. No alucines funcionalidades.${referenciaTemporal}`;
    const reglasGastos = `## Reglas sobre Gastos y Egresos (CRÍTICO)
1. **Diferenciación entre Egresos Reales y Compromisos Futuros**:
   - La tabla \`gasto\` contiene los egresos YA PAGADOS y devengados contablemente. Para preguntas como "¿Cuánto gasté?", "¿Cuál es mi balance?", "¿Cuánto dinero salió de caja?", consulta ÚNICAMENTE la tabla \`gasto\`.
   - La tabla \`gasto_programado\` contiene compromisos futuros pactados o reglas recurrentes (alquileres, sueldos, servicios). **NO son egresos reales todavía** ni restan dinero de la caja ni del balance del negocio.
2. **Consultas sobre el futuro y costos fijos**:
   - Si el comerciante pregunta por compromisos a futuro ("¿Qué pagos se me vienen?", "¿Qué gastos tengo esta semana/mes?", "¿Cuánto tengo en costos fijos?"), consulta \`gasto_programado\` con \`activo = 1\` y filtra o agrupa por \`proxima_ejecucion\` o \`tipo = 'recurrente'\`.
   - Si un gasto programado tiene \`auto_generar = 0\`, aclara con calidez que se trata de un monto estimado y que el sistema le solicitará ingresar el importe real de la boleta al momento de su vencimiento.
   - Si un gasto es \`auto_generar = 1\`, aclara que se asentará de forma automática en la fecha programada.
3. **Preguntas sobre cómo programar**:
   - Si el usuario te pide programar un gasto o te pregunta cómo funciona, explicale con amabilidad y claridad los pasos del manual (ir a Gastos > Nuevo Gasto > activar el switch de programar > elegir Única vez o Recurrente, frecuencia y fecha).`;
    const modulosActivosObj = contexto?.modulos_activos ?? {};
    const modulosEstadoResumen = Object.entries(modulosActivosObj)
        .filter(([k]) => k.startsWith('usar_') || k === 'categoria_multiple' || k === 'balanza_activa')
        .map(([k, v]) => `- ${k}: ${v ? 'ACTIVO' : 'DESACTIVADO'}`)
        .join('\n');
    const reglasModulos = `## Activación y Gestión de Módulos del Sistema y Catálogo (CRÍTICO)
Sos capaz de activar o desactivar de forma inmediata cualquiera de los 16 módulos del sistema y catálogo cuando el comerciante te lo pida en el chat.
También debes asesorarlo con maestría sobre qué hace cada uno, cómo se usa y cómo sacarle el mayor rédito comercial y operativo según su rubro, basándote en la sección "Módulos del Sistema y Catálogo" del manual.

### 1. Estado actual de los módulos en este comercio:
${modulosEstadoResumen || 'Todos los módulos estándar disponibles según configuración.'}

### 2. CERO consultas SQL para activar/desactivar módulos
- Si el usuario te pide activar, habilitar, desactivar o suspender módulos (ej: "activame el módulo de gastos", "desactivá presupuestos", "habilitá marcas y presentaciones", "quiero activar combos pero desactivar recargos"):
  - NUNCA generes SQL.
  - Respondé DIRECTAMENTE en texto plano explicando con entusiasmo y amabilidad el beneficio de activarlo (o recordando que los datos históricos se conservan seguros si lo desactiva).
  - Emití OBLIGATORIAMENTE el bloque Markdown exacto:
${B3}cambiar_modulo
{
  "cambios": [
    {
      "modulo": "usar_gastos",
      "activo": true,
      "nombre": "Módulo de Gastos Operativos",
      "grupo": "operativo",
      "descripcion": "Registro y planificación de egresos fijos y variables"
    }
  ]
}
${B3}
- Si el usuario pide modificar varios módulos a la vez (ej: "activá marcas y presentaciones y desactivá presupuestos"), incluí todos los módulos en el array "cambios".
- Claves admitidas para "modulo": "usar_marca", "usar_categoria", "categoria_multiple", "usar_presentaciones", "usar_iva", "usar_proveedor", "usar_gastos", "usar_clientes", "usar_presupuestos", "usar_combos", "usar_promociones", "usar_vencimientos", "usar_etiquetas", "usar_recargos", "usar_recordatorios", "usar_balanza".
- El sistema aplicará la modificación de inmediato en la base de datos y actualizará la interfaz sin recargar.

### 3. Asesoramiento sobre módulos:
Si el usuario pregunta para qué sirve un módulo, cómo se usa o cómo sacarle el mayor rédito:
- Explicale con calidez y claridad: 1) Qué hace y para qué sirve, 2) Cómo se usa en el día a día, y 3) Consejos y estrategias para sacarle el mayor rédito económico/operativo según el manual.
- Informale si lo tiene actualmente ACTIVO o DESACTIVADO en su comercio según el estado actual.
- Si lo tiene desactivado, invitalo cordialmente: "Si querés, avisame y te lo activo ahora mismo con un mensaje".`;
    const reglasRecordatorios = `## Creación interactiva de recordatorios
Sos capaz de agendar avisos y recordatorios personales para el comerciante.

### 1. Regla fundamental: CERO consultas SQL para empezar
- Cuando el comerciante exprese la intención de agendar o crear un recordatorio (ej: "recordame llamar al proveedor mañana a las 10", "crear recordatorio", "¿qué datos necesitás?", etc.):
  - NUNCA ejecutes ninguna consulta SQL. Respondé DIRECTAMENTE en texto plano conversacional con calidez.
  - Recopilá los datos esenciales:
    1. **Título / Asunto del recordatorio** (ej: "Llamar al distribuidor de lácteos")
    2. **Fecha y Hora de la alerta** (usa la Referencia Temporal Local para calcular la fecha YYYY-MM-DD y la hora HH:mm)
    3. **Notas / Descripción opcional**
    4. **Sonido de alerta** (opcional: "sound_01" a "sound_05", o "ninguno". Por defecto usá "sound_01")
  - Si el usuario ya te dio los datos en su mensaje (ej: "Recordame pagar la luz mañana a las 18 hs"), procedé DIRECTAMENTE a emitir el bloque.

### 2. Emisión OBLIGATORIA del bloque de recordatorio (CRÍTICO)
Cuando tengas el título, fecha y hora definidos:
- Incluí OBLIGATORIAMENTE el bloque Markdown exacto:
${B3}crear_recordatorio
{
  "titulo": "Título del recordatorio",
  "descripcion": "Detalles adicionales opcionales",
  "fecha": "YYYY-MM-DD",
  "hora": "HH:mm",
  "sonido": "sound_01"
}
${B3}
- Acompañá con el mensaje: "Revisá los datos en la tarjeta que aparece acá arriba, probá el tono de alarma si querés, y hacé clic en **Confirmar y Programar Recordatorio** para agendarlo inmediatamente."`;
    const reglasVoz = `## Capacidades de Voz y Audio
1. **Dictado por voz (Whisper STT)**:
   El comerciante puede hablarte por micrófono. El reconocimiento de voz funciona 100% offline en local sin internet. El sistema ofrece 3 modelos en Configuración > Binny:
   - **Whisper Tiny** (~75 MB, ultra ligero)
   - **Whisper Base** (~142 MB, **RECOMENDADO** por su excelente equilibrio entre velocidad y precisión en español)
   - **Whisper Small** (~466 MB, máxima precisión)
   Si el usuario te pregunta sobre el dictado o qué modelo elegir, recomendale siempre **Whisper Base**.

2. **Voz del Asistente (TTS / Reproducción)**:
   El comerciante puede escuchar tus respuestas habladas mediante el icono de parlante o la lectura automática. El sistema ofrece 3 motores de audio en Configuración > Binny:
   - **Piper TTS** (neuronal local de alta fidelidad humana en español, ~100 MB, 100% offline)
   - **Web Speech API** (nativa del sistema operativo, 0 MB)
   - **eSpeak NG** (sintética ligera robótica, 0 MB)
   Si te pregunta cómo escucharte, explicále que puede pulsar el parlante en cada mensaje o activar la lectura automática.`;
    const manual = `## Manual de uso del sistema
${MANUAL_SISTEMA}`;
    const schema = `## Estructura de la base de datos
${ESQUEMA_SQLITE}`;
    const seccionIvaCreacion = usarIva
        ? `  - **Módulo de IVA: HABILITADO en este comercio**:
    a. **Precios de venta al público (PVP)**: En el sistema los precios de venta son SIEMPRE con IVA incluido (PVP). Cuando el usuario te dice un precio de venta (ej: "venta 1500"), asumí que es el PVP final con IVA.
    b. **Alícuota impositiva**: La alícuota por defecto del negocio es ${alicuotaPred.porcentaje}% (${alicuotaPred.nombre}, id: ${alicuotaPred.id}). Si el usuario no menciona ninguna alícuota, asigná siempre id: ${alicuotaPred.id} (${alicuotaPred.porcentaje}%). Si menciona una alícuota específica (ej. 10.5%, 27% o exento al 0%), usá el ID que corresponda de las disponibles: ${alicuotasTexto}.
    c. **Desglose transparente en tu mensaje**: Al confirmar los datos del producto, explicále con calidez el desglose:
       - Precio Final PVP: $X (con IVA ${alicuotaPred.porcentaje}% incl.)
       - Neto Gravado: $Y (base imponible)
       - IVA Débito: $Z (tributo AFIP)
       - Costo: $C
       - Margen Comercial Neto: M%
    d. **JSON del bloque**: Incluí en el JSON "alicuota_iva_id": ${alicuotaPred.id} y "alicuota_iva_porcentaje": ${alicuotaPred.porcentaje}.`
        : `  - **Módulo de IVA: DESHABILITADO en este comercio**:
    El comercio opera con precios planos sin discriminación impositiva. NUNCA menciones IVA, ni AFIP, ni débitos fiscales. En el JSON del bloque incluye: "alicuota_iva_id": null.`;
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
${seccionIvaCreacion}
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
  ${usarIva ? `"alicuota_iva_id": ${alicuotaPred.id},\n  "alicuota_iva_porcentaje": ${alicuotaPred.porcentaje},` : `"alicuota_iva_id": null,`}
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

${reglasGastos}

${reglasModulos}

## Modo stream
- Respondé en lenguaje natural y amigable. NUNCA uses JSON o llaves sueltas en el texto plano, EXCEPTO cuando emitas bloques especiales autorizados (${B3}chart, ${B3}crear_producto, ${B3}crear_recordatorio o ${B3}cambiar_modulo).
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

${reglasRecordatorios}

${reglasVoz}

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
NUNCA generes consultas SQL para iniciar la creación interactiva de productos, recordatorios ni activación de módulos (eso va siempre por el Caso 2 en texto plano).

### Caso 2: Creación interactiva de productos, recordatorios y activación de módulos
Si el usuario manifiesta que quiere crear un producto, agendar un recordatorio nuevo o activar/desactivar módulos del sistema (ej: "recordame llamar a...", "quiero crear un producto", "activá gastos", "desactivá presupuestos", "habilitá marcas y combos", etc.):
- Respondé DIRECTAMENTE en texto plano conversando con calidez y pidiendo los datos esenciales según las Reglas correspondientes. NUNCA generes SQL para iniciar la creación ni para cambiar módulos.
- Cuando corresponda, emití obligatoriamente el bloque ${B3}crear_producto, ${B3}crear_recordatorio o ${B3}cambiar_modulo con el JSON correspondiente.

### Caso 3: Como usar el sistema o conversacion general
Si pregunta cómo hacer algo de forma teórica (explicación de pantallas, abrir caja, anular venta, dictado por voz, etc.) o es un saludo, respondé directamente en texto plano con los pasos del manual. NUNCA generes SQL para esto.

${reglasComunes}

${reglasGastos}

${reglasModulos}

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

${reglasCreacion}

${reglasRecordatorios}

${reglasVoz}

${manual}

${schema}`;
    }
    // Modo JSON (para /mensajes y /resultado)
    return `${identidad}

Tu trabajo es atender al comerciante respondiendo en tres casos:

### Caso 1: Datos del negocio
Si el usuario pregunta por numeros, reportes, stock, ventas, etc., genera una consulta SQL para obtener la respuesta.

### Caso 2: Creación interactiva de productos, recordatorios y activación de módulos
Si el usuario quiere crear un producto, agendar un recordatorio o activar/desactivar módulos con tu ayuda, respondé DIRECTAMENTE con preguntas amigables en texto plano para recopilar la información. NUNCA generes SQL para iniciar la creación ni para cambiar módulos. Cuando tengas los datos o la orden, responde con {tipo: "respuesta", texto: "... ${B3}crear_producto\\n{...}\\n${B3} ..."} o {tipo: "respuesta", texto: "... ${B3}crear_recordatorio\\n{...}\\n${B3} ..."} o {tipo: "respuesta", texto: "... ${B3}cambiar_modulo\\n{...}\\n${B3} ..."} para emitir la tarjeta interactiva.

### Caso 3: Como usar el sistema y soporte de voz
Si pregunta cómo hacer algo en general (abrir caja, dictado por voz, escuchar voz, etc.), responde directamente con pasos claros basandote en el manual. NUNCA generes SQL para esto.

${reglasComunes}

${reglasGastos}

${reglasModulos}

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

Pregunta: "Que pagos tengo que hacer esta semana?"
Respuesta: {tipo: "consulta", id_solicitud: "gastos_prog_01", sql: "SELECT gp.concepto, gp.monto, gp.tipo, gp.frecuencia, gp.auto_generar, DATETIME(gp.proxima_ejecucion, 'unixepoch', 'localtime') AS fecha_pago, cg.nombre AS categoria FROM gasto_programado gp LEFT JOIN categoria_gasto cg ON cg.id = gp.categoria_gasto_id WHERE gp.activo = 1 AND gp.proxima_ejecucion BETWEEN strftime('%s', 'now') AND strftime('%s', 'now', '+7 days') ORDER BY gp.proxima_ejecucion ASC LIMIT 20", descripcion: "Buscando tus pagos programados de la semana..."}

Pregunta: "Stock bajo"
Respuesta: {tipo: "consulta", id_solicitud: "stock_bajo_01", sql: "SELECT p.nombre, p.cantidad, p.stock_minimo, u.abreviatura FROM producto p JOIN unidad u ON u.id = p.unidad_id WHERE p.cantidad <= p.stock_minimo AND p.activo = 1 ORDER BY p.cantidad ASC LIMIT 50", descripcion: "Buscando productos con stock bajo..."}

Pregunta: "Cliente que mas me debe?"
Respuesta: {tipo: "consulta", id_solicitud: "deudores_01", sql: "SELECT nombre, documento, saldo_actual FROM cliente WHERE saldo_actual > 0 AND activo = 1 ORDER BY saldo_actual DESC LIMIT 10", descripcion: "Buscando clientes con deuda..."}

## Formato de respuesta
Datos del negocio: {tipo: "consulta", id_solicitud: "abc123", sql: "SELECT ...", descripcion: "Buscando tus [datos]..."}
Uso del sistema, conversacion o creación de producto: {tipo: "respuesta", texto: "Respuesta con texto o bloque ${B3}crear_producto"}

${reglasCreacion}

${reglasRecordatorios}

${reglasVoz}

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
            { role: 'system', content: construirPromptSistema('json', data.contexto) },
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
    async uso(data) {
        const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
        return obtenerUso(lic.id);
    }
    async procesarFacturaOcr(data) {
        const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
        const cantidadMensajes = env.CHAT_MENSAJES_POR_OCR;
        const usoCheck = await incrementarMensajes(lic.id, cantidadMensajes);
        if (!usoCheck) {
            const limite = await obtenerLimiteChat(lic.id);
            httpError(`Alcanzaste tu límite mensual de consultas (${limite}). El escaneo de facturas requiere ${cantidadMensajes} consultas. Se renueva el día 1 del próximo mes.`, 429);
        }
        const uso = usoCheck;
        let imageUrl = data.imagen_base64.trim();
        if (!imageUrl.startsWith('data:')) {
            const mime = data.mime_type || 'image/jpeg';
            imageUrl = `data:${mime};base64,${imageUrl}`;
        }
        const promptSistema = `Sos un asistente contable de alta precisión especializado en digitalización y extracción de comprobantes comerciales, facturas y remitos de proveedores (Argentina y Latinoamérica).
Tu objetivo es transcribir con máxima fidelidad la información de la imagen adjunta en un único objeto JSON estructurado.

Estructura JSON requerida:
{
  "tipo_comprobante": "Factura A, Factura B, Factura C, Remito o Presupuesto (o null)",
  "proveedor_nombre": "Razón social o nombre comercial del proveedor emisor (o null)",
  "cuit": "CUIT o identificación fiscal del emisor si figura (o null)",
  "numero_comprobante": "Número de factura o remito tal como figura (ej: 0001-00045231) (o null)",
  "fecha": "Fecha de emisión en formato YYYY-MM-DD (o null)",
  "items": [
    {
      "descripcion": "Descripción o nombre del producto exactamente como aparece en la factura",
      "codigo": "Código interno o de barras si figura en el renglón (o null)",
      "cantidad": 1.0,
      "precio_unitario": 100.0,
      "subtotal": 100.0,
      "unidades_por_bulto": null,
      "descuento_porcentaje": null,
      "alicuota_iva": null
    }
  ],
  "subtotal_neto": null,
  "iva_total": null,
  "percepciones_total": null,
  "total": 100.0
}

Reglas estrictas:
- Devuelve SOLAMENTE el objeto JSON válido. Sin markdown ni comentarios adicionales.
- Los campos numéricos ("cantidad", "precio_unitario", "subtotal", "total", "unidades_por_bulto", "descuento_porcentaje", "alicuota_iva") DEBEN ser números válidos o null.
- "unidades_por_bulto": Si la descripción o presentación indica un pack/caja/fardo (ej: "PACK X 6", "CAJA X 12", "DISPLAY X 24", "X 8"), extrae la cantidad de unidades por bulto como número entero (ej: 6, 12, 24). Si es por unidad suelta o no se especifica, pon null.
- "descuento_porcentaje": Si el renglón tiene un porcentaje de descuento o bonificación (ej: 5%, 10%), extrae el número (ej: 10.0). Si no hay descuento, pon null o 0.
- "alicuota_iva": Si en el renglón o columna figura la alícuota de IVA aplicada (ej: 21%, 10.5%), extrae el número (ej: 21.0 o 10.5). Si no se indica, pon null.
- "tipo_comprobante": Identifica claramente la letra o tipo en la cabecera (Letra A, B, C, o Remito).
- En "items", extrae TODOS y cada uno de los renglones de mercadería que figuren en la factura. No omitas ninguno.
- Si un ítem no tiene subtotal explícito, calcula cantidad * precio_unitario.`;
        const mensajes = [
            { role: 'system', content: promptSistema },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Extrae detalladamente todos los datos y la lista de productos de este comprobante en formato JSON.' },
                    { type: 'image_url', image_url: { url: imageUrl } },
                ],
            },
        ];
        try {
            const { texto, tokens } = await llamarLLMVision(mensajes, { jsonMode: true });
            if (tokens.total_tokens > 0) {
                await acumularTokens(lic.id, tokens);
            }
            let jsonLimpio = texto.trim();
            if (jsonLimpio.startsWith('```json')) {
                jsonLimpio = jsonLimpio.slice(7);
            }
            else if (jsonLimpio.startsWith('```')) {
                jsonLimpio = jsonLimpio.slice(3);
            }
            if (jsonLimpio.endsWith('```')) {
                jsonLimpio = jsonLimpio.slice(0, -3);
            }
            jsonLimpio = jsonLimpio.trim();
            const parsed = JSON.parse(jsonLimpio);
            const items = Array.isArray(parsed.items)
                ? parsed.items.map((it) => ({
                    descripcion: String(it.descripcion || 'Producto').trim(),
                    codigo: it.codigo ? String(it.codigo).trim() : null,
                    cantidad: Math.max(0.001, Number(it.cantidad) || 1),
                    precio_unitario: Math.max(0, Number(it.precio_unitario) || 0),
                    subtotal: Number(it.subtotal) || (Number(it.cantidad) || 1) * (Number(it.precio_unitario) || 0),
                    unidades_por_bulto: it.unidades_por_bulto ? Number(it.unidades_por_bulto) : null,
                    descuento_porcentaje: it.descuento_porcentaje != null ? Number(it.descuento_porcentaje) : null,
                    alicuota_iva: it.alicuota_iva != null ? Number(it.alicuota_iva) : null,
                }))
                : [];
            const totalCalculado = items.reduce((acc, it) => acc + it.subtotal, 0);
            const total = Number(parsed.total) || totalCalculado;
            const resultado = {
                tipo_comprobante: parsed.tipo_comprobante ? String(parsed.tipo_comprobante).trim() : null,
                proveedor_nombre: parsed.proveedor_nombre ? String(parsed.proveedor_nombre).trim() : null,
                cuit: parsed.cuit ? String(parsed.cuit).trim() : null,
                numero_comprobante: parsed.numero_comprobante ? String(parsed.numero_comprobante).trim() : null,
                fecha: parsed.fecha ? String(parsed.fecha).trim() : null,
                items,
                subtotal_neto: parsed.subtotal_neto ? Number(parsed.subtotal_neto) : null,
                iva_total: parsed.iva_total ? Number(parsed.iva_total) : null,
                percepciones_total: parsed.percepciones_total ? Number(parsed.percepciones_total) : null,
                total,
            };
            return {
                datos: resultado,
                uso: {
                    ...uso,
                    mensajes_descontados: cantidadMensajes,
                },
            };
        }
        catch (err) {
            await decrementarMensajes(lic.id, cantidadMensajes);
            console.error('[Factura OCR Error]:', err);
            throw httpError(`Error al procesar la imagen de la factura con IA: ${err instanceof Error ? err.message : String(err)}`, 500);
        }
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
            { role: 'system', content: construirPromptSistema('fase1', data.contexto) },
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
const sesionesMovil = new Map();
// Limpiar sesiones expiradas periódicamente cada 5 minutos
setInterval(() => {
    const ahora = Date.now();
    for (const [id, s] of sesionesMovil.entries()) {
        if (ahora > s.expiraEn) {
            sesionesMovil.delete(id);
        }
    }
}, 5 * 60 * 1000);
export function crearSesionMovil() {
    const sessionId = 'movil_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    const creadaEn = Date.now();
    const expiraEn = creadaEn + 15 * 60 * 1000; // 15 minutos
    sesionesMovil.set(sessionId, {
        sessionId,
        creadaEn,
        expiraEn,
        estado: 'esperando',
    });
    return { sessionId, expiraEn };
}
export function obtenerEstadoSesionMovil(sessionId) {
    const sesion = sesionesMovil.get(sessionId);
    if (!sesion) {
        return { estado: 'no_encontrada' };
    }
    if (Date.now() > sesion.expiraEn) {
        sesion.estado = 'expirada';
        return { estado: 'expirada' };
    }
    return {
        estado: sesion.estado,
        imagenBase64: sesion.imagenBase64,
        mimeType: sesion.mimeType,
        nombreArchivo: sesion.nombreArchivo,
    };
}
export function subirImagenSesionMovil(sessionId, imagenBase64, mimeType, nombreArchivo) {
    const sesion = sesionesMovil.get(sessionId);
    if (!sesion || Date.now() > sesion.expiraEn) {
        return false;
    }
    sesion.imagenBase64 = imagenBase64;
    sesion.mimeType = mimeType || 'image/jpeg';
    sesion.nombreArchivo = nombreArchivo || 'factura_celular.jpg';
    sesion.estado = 'completada';
    return true;
}
export function renderHtmlMovil(sessionId) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Cargar Factura al POS - Binny</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #0f172a; color: #f8fafc; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; width: 100%; max-width: 420px; padding: 24px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); text-align: center; }
    .icon-box { width: 64px; height: 64px; border-radius: 18px; background: rgba(139, 92, 246, 0.15); color: #a78bfa; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; border: 1px solid rgba(139, 92, 246, 0.3); }
    h1 { font-size: 1.25rem; font-weight: 700; margin-bottom: 6px; color: #fff; }
    p { font-size: 0.85rem; color: #94a3b8; line-height: 1.4; margin-bottom: 20px; }
    .btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 14px; border-radius: 14px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: all 0.2s; border: none; }
    .btn-primary { background: #7c3aed; color: #fff; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4); }
    .btn-primary:active { transform: scale(0.98); background: #6d28d9; }
    .btn-secondary { background: #334155; color: #f8fafc; border: 1px solid #475569; }
    .btn-secondary:active { transform: scale(0.98); background: #1e293b; }
    .btn-outline { background: transparent; border: 1px solid #475569; color: #cbd5e1; margin-top: 10px; }
    .preview-box { margin-top: 16px; border-radius: 14px; overflow: hidden; max-height: 240px; border: 1px solid #475569; position: relative; background: #000; }
    .preview-box img { width: 100%; height: auto; max-height: 240px; object-fit: contain; display: block; }
    .status { margin-top: 16px; padding: 12px; border-radius: 12px; font-size: 0.85rem; display: none; }
    .status.success { background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; display: block; }
    .status.error { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; display: block; }
    .status.loading { background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); color: #c4b5fd; display: block; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; background: #7c3aed; color: #fff; text-transform: uppercase; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card" id="mainCard">
    <div class="badge">OCR Móvil en Tiempo Real</div>
    <div class="icon-box">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
        <circle cx="12" cy="13" r="3"/>
      </svg>
    </div>
    <h1>Enviar Factura a tu PC</h1>
    <p>Sacá una foto con la cámara o elegí una imagen existente desde la galería de tu celular.</p>

    <input type="file" id="fileInputCamara" accept="image/*" capture="environment" style="display:none">
    <input type="file" id="fileInputGaleria" accept="image/*" style="display:none">
    
    <div id="actionButtons" style="display: flex; flex-direction: column; gap: 10px;">
      <button class="btn btn-primary" onclick="document.getElementById('fileInputCamara').click()">
        📸 Sacar Foto con la Cámara
      </button>
      <button class="btn btn-secondary" onclick="document.getElementById('fileInputGaleria').click()">
        🖼️ Elegir de la Galería
      </button>
    </div>

    <div id="previewContainer" style="display:none">
      <div class="preview-box">
        <img id="previewImg" src="" alt="Vista previa">
      </div>
      <button class="btn btn-primary" id="btnEnviar" style="margin-top: 14px;" onclick="enviarFoto()">
        🚀 Enviar Comprobante al POS
      </button>
      <button class="btn btn-outline" onclick="reintentar()">
        🔄 Elegir otra foto o imagen
      </button>
    </div>

    <div id="statusBox" class="status"></div>
  </div>

  <script>
    const sessionId = "${sessionId}";
    let imagenBase64 = null;
    let mimeType = 'image/jpeg';
    let nombreArchivo = 'factura_movil.jpg';

    const fileInputCamara = document.getElementById('fileInputCamara');
    const fileInputGaleria = document.getElementById('fileInputGaleria');
    const previewContainer = document.getElementById('previewContainer');
    const actionButtons = document.getElementById('actionButtons');
    const previewImg = document.getElementById('previewImg');
    const statusBox = document.getElementById('statusBox');
    const btnEnviar = document.getElementById('btnEnviar');

    function procesarArchivo(file) {
      if (!file) return;

      nombreArchivo = file.name || 'comprobante_movil.jpg';
      mimeType = file.type || 'image/jpeg';
      mostrarEstado('Comprimiendo y optimizando foto...', 'loading');

      const reader = new FileReader();
      reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
          // Escalar a max 1800px para carga ultra-rápida y excelente nitidez OCR
          const maxDim = 1800;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          imagenBase64 = canvas.toDataURL('image/jpeg', 0.86);
          previewImg.src = imagenBase64;
          previewContainer.style.display = 'block';
          actionButtons.style.display = 'none';
          ocultarEstado();
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }

    fileInputCamara.addEventListener('change', function(e) {
      const file = e.target.files && e.target.files[0];
      procesarArchivo(file);
    });

    fileInputGaleria.addEventListener('change', function(e) {
      const file = e.target.files && e.target.files[0];
      procesarArchivo(file);
    });

    function reintentar() {
      imagenBase64 = null;
      fileInputCamara.value = '';
      fileInputGaleria.value = '';
      previewContainer.style.display = 'none';
      actionButtons.style.display = 'flex';
      ocultarEstado();
    }

    async function enviarFoto() {
      if (!imagenBase64) return;
      btnEnviar.disabled = true;
      btnEnviar.innerText = 'Transfiriendo a la PC...';
      mostrarEstado('Enviando comprobante al sistema...', 'loading');

      try {
        const res = await fetch('/api/chat/movil-factura/' + sessionId + '/subir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imagenBase64, mimeType, nombreArchivo })
        });
        const data = await res.json();
        if (res.ok) {
          mostrarEstado('✅ ¡Comprobante recibido en tu computadora! Ya podés cerrar esta pantalla.', 'success');
          previewContainer.style.display = 'none';
        } else {
          mostrarEstado('❌ Error: ' + (data.error || 'No se pudo enviar'), 'error');
          btnEnviar.disabled = false;
          btnEnviar.innerText = '🚀 Enviar Comprobante al POS';
        }
      } catch (err) {
        mostrarEstado('❌ Error de conexión al enviar', 'error');
        btnEnviar.disabled = false;
        btnEnviar.innerText = '🚀 Enviar Comprobante al POS';
      }
    }

    function mostrarEstado(msg, tipo) {
      statusBox.innerText = msg;
      statusBox.className = 'status ' + tipo;
    }

    function ocultarEstado() {
      statusBox.className = 'status';
      statusBox.style.display = 'none';
    }
  </script>
</body>
</html>`;
}
