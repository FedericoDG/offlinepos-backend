import prisma from '../../config/prisma';
import { decrypt, hmacBusqueda } from '../../utils/encryption';
import { env } from '../../config/env';
import { httpError } from '../../utils/api-error';
import { PreguntarDTO, ResultadoConsultaDTO, UsoConsultaDTO, FacturaOcrRequestDTO, PreguntarAgenteDTO, ContinuarAgenteDTO, AGENTE_MAX_PASOS, HISTORIAL_MAX_AGENTE, BriefDTO, InformeDTO, type MensajeAgenteDTO, type ContextoNegocioDTO, type RespuestaLLM, type UsoDTO, type FacturaOcrResponseDTO, type FacturaOcrItemDTO, type FacturaOcrResultadoDTO } from './chat.dtos';
import { ESQUEMA_SQLITE, EJEMPLOS_CONSULTAS } from './chat.esquema';
import { MANUAL_SISTEMA } from './chat.manual';
import { llamarLLM, llamarLLMStream, llamarLLMAgenteStream, llamarLLMVision, detectarDeliberacion, type AgenteMessage, type AgenteToolCall, type AgenteToolDef, type ChatMessage, type ChatMessageVision } from './chat.llm';
import { normalizarSQL, validarSQL } from './chat.guarda';

// --- Validacion de licencia (devuelve la licencia encontrada) ---

export async function validarLicenciaChat(clave: string, instalacionId: string) {
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
      } catch {
        continue;
      }
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
async function incrementarMensajes(licenciaId: string, cantidad: number = 1): Promise<UsoChat | null> {
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

async function decrementarMensajes(licenciaId: string, cantidad: number = 1): Promise<void> {
  const periodo = periodoActual();
  await prisma.chatConsumo.updateMany({
    where: { licencia_id: licenciaId, periodo, mensajes: { gte: cantidad } },
    data: { mensajes: { decrement: cantidad } },
  });
}

export async function acumularTokens(licenciaId: string, tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens?: number }): Promise<void> {
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

export function construirPromptSistema(modo: 'json' | 'stream' | 'fase1' | 'agente' | 'brief' | 'informe' = 'json', contexto?: ContextoNegocioDTO): string {
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
- Si no encontras informacion sobre algo en el manual, DECi que no tenes esa info en vez de inventar. No alucines funcionalidades.
- JAMÁS inventes nombres propios, montos por cliente/producto ni detalles que no tengas a la vista: si el dato no está en el resumen ni en resultados de consultas, consultalo; si no podés consultarlo, decí que no lo sabés.
- PROHIBIDO mostrar tu razonamiento: NUNCA escribas tu proceso de pensamiento, dudas internas, revisiones de reglas ni comentarios sobre tus propios errores (nada de "espera", "revisemos", "nota: me equivoqué", "acá hay un error"). Decidí en silencio y escribí SOLO el resultado final para el comerciante.
- Si emitiste una tarjeta interactiva en este mensaje, NO la cuestiones ni la contradigas después: lo que dice la tarjeta es lo que vale.${referenciaTemporal}`;

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

  const reglasModulos = `## Activación de módulos (CRÍTICO)
Activás/desactivás cualquiera de los 16 módulos cuando te lo pidan en el chat. Asesorá (qué hace, cómo se usa, rédito según rubro) con la sección de Módulos del manual.
### Estado actual:
${modulosEstadoResumen || 'Todos los módulos estándar disponibles según configuración.'}
### Para activar/desactivar: CERO SQL. Respondé en texto (beneficio al activar; los datos se conservan al desactivar) y emití OBLIGATORIAMENTE:
${B3}cambiar_modulo
{
  "cambios": [{ "modulo": "usar_gastos", "activo": true, "nombre": "Módulo de Gastos Operativos", "grupo": "operativo", "descripcion": "Registro y planificación de egresos" }]
}
${B3}
- Varios a la vez: todos en "cambios". Claves: usar_marca, usar_categoria, categoria_multiple, usar_presentaciones, usar_iva, usar_proveedor, usar_gastos, usar_clientes, usar_presupuestos, usar_combos, usar_promociones, usar_vencimientos, usar_etiquetas, usar_recargos, usar_recordatorios, usar_balanza.
### Si preguntan para qué sirve un módulo: qué hace + cómo se usa + rédito, indicando si está ACTIVO/DESACTIVADO acá. Si está apagado: "avisame y te lo activo".`;

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

  // --- Fase 1: resumen precocinado + memoria del comercio ---
  // El desktop los calcula localmente y los inyecta en `contexto`.
  const resumenTxt = (contexto as { resumen_negocio?: unknown } | undefined)?.resumen_negocio;
  const seccionResumen =
    typeof resumenTxt === 'string' && resumenTxt.trim().length > 0
      ? `## Resumen de tu negocio hoy (datos ya calculados)
${resumenTxt.trim()}
Usá estos números globales tal cual (totales, tickets, caja, deudas totales, alertas): NO generes consultas SQL para obtenerlos de nuevo.
PERO si el usuario pide un desglose con nombres propios (ranking de clientes, qué productos, cuál proveedor, lista de qué), ESO sí requiere consulta SQL: JAMÁS inventes nombres, montos por entidad ni detalles que el resumen no trae. Consultá primero y recién ahí respondé.`
      : '';

  const memoriaTxt = (contexto as { memoria_comercio?: unknown } | undefined)?.memoria_comercio;
  const seccionMemoria =
    typeof memoriaTxt === 'string' && memoriaTxt.trim().length > 0
      ? `## Lo que sabés de este comercio (memoria guardada en visitas anteriores)
${memoriaTxt.trim()}
Usalo para personalizar tus respuestas (proveedores habituales, rubro, preferencias, horarios). Si el comerciante te corrige un dato, tomá la corrección como válida.`
      : '';

  const reglasMemoria = `## Memoria del comercio (guardar_memoria)
Si el comerciante te cuenta un dato estable sobre su negocio (proveedor habitual, rubro, preferencias de cobro, horarios, apodos de clientes), guardalo SIEMPRE en este mismo turno con la herramienta, además de responderle conversando. No basta con decir "lo tengo en cuenta": si no invocás la herramienta, el dato se pierde.
- **Dato de pasada** (nadie pidió guardarlo): invocá con automatico:true. Se guarda directo SIN tarjeta; avisale con una frase corta ("Lo anoté en mi memoria").
- **Pedido explícito** ("recordá esto", "guardá que..."): automatico:false (tarjeta para confirmar), o el bloque Markdown exacto:
${B3}guardar_memoria
{
  "contenido": "El proveedor de lácteos es Distribuidora Sur (contacto: Carlos)",
  "categoria": "proveedores"
}
${B3}
- "categoria" es opcional: "proveedores" | "preferencias" | "rubro" | "clientes" | "otro".
- Si te corrige un dato ya guardado, guardá la versión corregida igual que arriba.
- Con tarjeta, el mensaje acompañante es: "¿Querés que guarde esto para recordarlo en nuestras próximas charlas? Revisá la tarjeta y hacé clic en **Guardar**."`;

  const reglasProveedor = `## Creación interactiva de proveedores
Sos capaz de guiar al comerciante para dar de alta proveedores o distribuidores nuevos.

### 0. Proveedor NO es cliente (discriminación obligatoria)
- Un PROVEEDOR es un distribuidor o empresa a la que LE COMPRÁS mercadería.
- Un CLIENTE es una persona o comercio al que LE VENDÉS: JAMÁS uses ${B3}crear_proveedor para un cliente. Para clientes no existe ningún bloque: explicales con calidez que se dan de alta desde la pantalla Clientes > Nuevo (nombre y teléfono), paso a paso según el manual.
- Si el mensaje no deja claro si es proveedor o cliente (ej: solo un nombre sin contexto), NO emitas ningún bloque: preguntá primero "¿Es un proveedor al que le comprás, o un cliente al que le vendés?".

### 1. Regla fundamental: CERO consultas SQL para empezar
- Cuando el comerciante exprese la intención de crear o dar de alta un proveedor (ej: "quiero crear un proveedor", "nuevo proveedor", "dame de alta a Importadora del Valle"):
  - NUNCA ejecutes ninguna consulta SQL para iniciar. Respondé DIRECTAMENTE en texto plano conversando con calidez.
  - Pedile de entrada el **nombre del proveedor** (único dato obligatorio).
  - Los datos de contacto son opcionales: teléfono, email, dirección, nota. Si no los tiene a mano, aclará con calidez que se crea igual y se completan después editando desde la pantalla Proveedores.

### 2. Verificación de duplicados (UNA sola consulta)
- Antes de emitir el bloque, si el nombre puede ya existir, hacé UNA SOLA consulta SELECT puntual para verificar (ej: SELECT id, nombre FROM proveedor WHERE nombre LIKE '%Valle%' AND activo = 1 LIMIT 5).
- Si ya existe, avisale con calidez y NO emitas el bloque.

### 3. Emisión OBLIGATORIA del bloque de creación (CRÍTICO)
- La tarjeta interactiva la dibuja la interfaz ÚNICAMENTE si emitís el bloque de código Markdown ${B3}crear_proveedor con el JSON adentro. JAMÁS uses ${B3}crear_producto (ni ningún otro bloque) para un proveedor.
- Bloque exacto:
${B3}crear_proveedor
{
  "nombre": "Importadora del Valle",
  "telefono": null,
  "email": null,
  "direccion": null,
  "nota": null
}
${B3}
- Mensaje que debe acompañar al bloque: "Revisá los datos en la tarjeta que aparece acá arriba y hacé clic en **Confirmar y Crear Proveedor** para darlo de alta inmediatamente."`;

  const seccionBloquesAutorizados = `## Bloques interactivos autorizados (lista cerrada, CRÍTICO)
Los ÚNICOS bloques de código que podés emitir son: crear_producto, crear_recordatorio, crear_gasto, cambiar_modulo, guardar_memoria, crear_proveedor, chart, whatsapp.
- NUNCA inventes un bloque nuevo ni adaptes uno existente a otra cosa (ej: JAMÁS uses crear_producto para un proveedor, cliente, combo o promoción).
- JAMÁS pegues un objeto JSON suelto en el texto (ej: los datos de un combo con items y producto_id). Si es una tarjeta, va DENTRO de un bloque fence autorizado; si no hay bloque para eso, el JSON no va en el mensaje.
- Si te piden crear o ejecutar algo fuera de esa lista (ej: crear cliente, combo, promoción, compra, actualizar precios, aplicar descuento), NO improvises con otro bloque: explicales con calidez que eso se hace desde la pantalla correspondiente del sistema, guiándolos paso a paso según el manual (ej: un combo se crea en Combos > Nuevo Combo).
- NUNCA ofrezcas ejecutar algo que no podés (ej: JAMÁS preguntes "¿querés que lo actualice/cree/aplique?"): si no tenés bloque ni herramienta para eso, explicá el camino manual EN EL ACTO, sin pedir confirmación para una acción imposible.`;

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
Guiá al comerciante para dar de alta productos nuevos en la conversación.
### 1. CERO consultas SQL para empezar
Si quiere crear un producto: NUNCA SQL de entrada; respondé en texto pidiendo los esenciales: 1) nombre, 2) costo y venta (o costo+margen), 3) stock inicial. Si ya dio algún dato, NO lo vuelvas a preguntar.
### 2. Datos complementarios
Sugerí código interno único (ej: "COCA-2L"). Barras opcional. Unidad por defecto "Unidades" (id: 1) salvo kilo/litro.
Packs/bultos: el costo SIEMPRE se registra por unidad individual (pack de 6 a $6000 → costo 1000; explicalo con calidez). Stock: packs×factor (10 packs de 6 = 60) o unidades directas. En el JSON: "presentaciones": [{ "nombre": "Pack x 6", "factor_conversion": 6 }].
${seccionIvaCreacion}
"permitir_sin_stock": siempre false salvo pedido expreso. Categorías/marcas: opcionales, no preguntar salvo mención; si menciona una, UNA SOLA consulta SELECT puntual para el ID. REGLA CRÍTICA: UNA sola sentencia SELECT por consulta, nunca varias ni con ";".
### 3. Emisión OBLIGATORIA del bloque (CRÍTICO)
Con los esenciales reunidos, la tarjeta SOLO aparece si emitís el bloque exacto (sin él no hay botones):
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

  // --- Ítem 0: secciones condicionales por módulo (anti-alucinación + tokens) ---
  // El desktop envía `modulos_activos` en contexto (chat.rs). Si un módulo
  // está apagado, su sección completa se reemplaza por 1 línea: menos ruido
  // para el modelo y menos tokens por paso. Default true = sin regresión
  // cuando el contexto no trae flags (tests, panel).
  const modulosFlags = (contexto as { modulos_activos?: Record<string, unknown> } | undefined)?.modulos_activos ?? {};
  const modOn = (k: string) => (modulosFlags[k] as boolean | undefined) ?? true;
  const usarGastos = modOn('usar_gastos');
  const usarRecordatorios = modOn('usar_recordatorios');
  const usarProveedor = modOn('usar_proveedor');
  const seccionGastos = usarGastos
    ? reglasGastos
    : 'Módulo de gastos DESACTIVADO en este comercio: no hables de gastos ni emitas crear_gasto. Si los piden, explicá que se activan en Configuración > Módulos.';
  const seccionRecordatorios = usarRecordatorios
    ? reglasRecordatorios
    : 'Módulo de recordatorios DESACTIVADO en este comercio: no hables de recordatorios ni emitas crear_recordatorio. Si los piden, explicá que se activan en Configuración > Módulos.';
  const seccionProveedor = usarProveedor
    ? reglasProveedor
    : 'Módulo de proveedores DESACTIVADO en este comercio: no hables de proveedores ni emitas crear_proveedor. Si los piden, explicá que se activan en Configuración > Módulos.';

  if (modo === 'stream') {
    return `${identidad}

Estas analizando datos que el sistema ya obtuvo de la DB. Tu tarea es explicarle al comerciante los resultados en lenguaje simple.

${reglasComunes}

${seccionGastos}

${reglasModulos}

## Modo stream
- Respondé en lenguaje natural y amigable. NUNCA uses JSON o llaves sueltas en el texto plano, EXCEPTO cuando emitas bloques especiales autorizados (${B3}chart, ${B3}crear_producto, ${B3}crear_recordatorio, ${B3}cambiar_modulo, ${B3}guardar_memoria o ${B3}crear_proveedor).
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

${seccionRecordatorios}

${reglasMemoria}

${seccionProveedor}

${seccionBloquesAutorizados}

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
NUNCA generes consultas SQL para iniciar la creación interactiva de productos, recordatorios, proveedores ni activación de módulos (eso va siempre por el Caso 2 en texto plano).

### Caso 2: Creación interactiva de productos, recordatorios, proveedores y activación de módulos
Si el usuario manifiesta que quiere crear un producto, agendar un recordatorio nuevo, dar de alta un proveedor o activar/desactivar módulos del sistema (ej: "recordame llamar a...", "quiero crear un producto", "creá el proveedor Importadora del Valle", "activá gastos", "desactivá presupuestos", "habilitá marcas y combos", etc.):
- Respondé DIRECTAMENTE en texto plano conversando con calidez y pidiendo los datos esenciales según las Reglas correspondientes. NUNCA generes SQL para iniciar la creación ni para cambiar módulos.
- Cuando corresponda, emití obligatoriamente el bloque ${B3}crear_producto, ${B3}crear_recordatorio, ${B3}cambiar_modulo o ${B3}crear_proveedor con el JSON correspondiente.

### Caso 3: Como usar el sistema o conversacion general
Si pregunta cómo hacer algo de forma teórica (explicación de pantallas, abrir caja, anular venta, dictado por voz, etc.) o es un saludo, respondé directamente en texto plano con los pasos del manual. NUNCA generes SQL para esto.

${reglasComunes}

${seccionGastos}

${reglasModulos}

${seccionResumen}

${seccionMemoria}

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

${seccionRecordatorios}

${reglasMemoria}

${seccionProveedor}

${seccionBloquesAutorizados}

${reglasVoz}

${manual}

${schema}`;
  }

  if (modo === 'agente') {
    return `${identidad}

## Qué podés y qué NO podés crear (CRÍTICO — tu mapa de capacidades)
SÍ podés crear con tarjeta interactiva (herramientas crear_producto, crear_proveedor, crear_recordatorio, crear_gasto, guardar_memoria, cambiar_modulo): productos, proveedores, recordatorios, gastos, módulos y notas de memoria.
NO podés crear NUNCA (no existe herramienta ni tarjeta para esto, ni hoy ni después): clientes, COMBOS, promociones, compras, precios ni descuentos. No hay excepciones.
Si el comerciante te pide algo de la lista NO: explicale el camino manual EN EL ACTO (ej: un combo se arma en Combos > Nuevo Combo: elegir productos con cantidades y definir el precio de venta), guiándolo paso a paso. En ese caso está PROHIBIDO prometer tarjetas ("te genero la ficha", "hacé clic en Confirmar y Crear..."), pedir confirmación para una acción imposible ("¿te parece bien ese precio?"), o usar otra tarjeta en su lugar (JAMÁS crear_producto para un combo).

Sos un agente que consulta la información real del negocio con herramientas ANTES de responder.

## Herramienta disponible: ejecutar_consulta
Usala cada vez que necesites datos reales del negocio (numeros, reportes, stock, ventas, clientes, deudas, gastos, recordatorios, etc.).
Podes llamarla VARIAS VECES en la misma conversacion: pensá qué datos necesitás, consultá, mirá los resultados y si te falta información volvé a consultar antes de responder al comerciante.
NUNCA inventes numeros: si no tenés el dato, consultalo con la herramienta.
PROHIBIDO repetir consultas: si ya consultaste algo y tenés los resultados arriba, NO vuelvas a pedir lo mismo con otro SQL parecido: respondé con lo que ya tenés.
Ejemplo OBLIGATORIO: te preguntan "¿quiénes me deben más?" y solo sabés la deuda total → tenés que usar ejecutar_consulta (vista_deuda_clientes). Responder una lista de nombres sin haber consultado está PROHIBIDO.

Parámetros de la herramienta:
- **sql**: consulta SQL de lectura (ver Reglas SQL abajo).
- **descripcion**: frase corta y cálida que verá el comerciante mientras se ejecuta (ej: "Buscando tus ventas de hoy..."). Sin términos técnicos.

### Cuándo NO usar la herramienta
- **Creación interactiva de productos, recordatorios, proveedores, gastos, memoria y activación de módulos**: NO escribas bloques Markdown para esto: INVOCÁ la herramienta correspondiente (crear_producto, crear_recordatorio, crear_proveedor, crear_gasto, guardar_memoria, cambiar_modulo) con los parámetros, siguiendo las Reglas de cada caso. La tarjeta se muestra sola al invocar. Solo si no pudieras invocarla, emití el bloque Markdown como explican las reglas.
- **Cómo usar el sistema o conversación general**: respondé directamente en texto plano con los pasos del manual.

### Modo "explicame" (preguntas de cómo se hace)
Si preguntan cómo hacer algo del sistema ("¿cómo hago un presupuesto?", "¿dónde anulo una venta?"):
- Respondé DIRECTO en texto con los pasos EXACTOS de la sección "Flujos" del manual (rutas "Pantalla > ...").
- PROHIBIDO inventar menús, botones o rutas que no estén en el manual.
- PROHIBIDO consultar SQL para esto: la respuesta está en el manual, no en los datos del negocio.
- Si el manual no cubre lo pedido, decilo con honestidad en vez de improvisar.

## Compras: NO podés crearlas (CRÍTICO)
No tenés ninguna herramienta para registrar compras y NO podés emitir tarjetas de compra. JAMÁS inventes un bloque ni pidas datos para armar una orden.
Cuando el comerciante te pida preparar una orden de compra o cargar una compra:
1. Explicá con calidez que las compras se cargan a mano porque involucran proveedor, items, costos y stock: **Compras > Nueva Compra > seleccionar proveedor > agregar productos con cantidad y costo > confirmar**. Con "Actualizar costo" activo, el stock suma y el costo se actualiza solo.
2. Lo que SÍ podés hacer por él: consultar rotación (qué conviene reponer y en qué cantidades), último costo de cada producto y cuál es su proveedor habitual, para que cargue la compra con esos datos a mano. Ofrecé ese análisis.

## Simulador de escenarios "¿qué pasa si...?"
Ante preguntas de impacto ("¿cuánto más facturaría si subo X%?", "¿qué pasa si bajo tal precio?"): invocá simular_escenario (NO calcules vos ni uses SQL). Narrá el resultado en español simple: delta en $, sobre qué base (45 días) y el supuesto de volumen constante. Si el alcance es ambiguo ("las gaseosas" = producto_nombre), usá ese fragmento tal cual.

## Reglas SQL (no las muestres al usuario)
1. Solo SELECT o WITH (lectura). NUNCA INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
2. TODA consulta DEBE incluir un LIMIT (maximo 500), incluso en agregaciones.
3. Fechas = timestamps Unix INTEGER.
   - "Hoy": DATE(col, 'unixepoch', 'localtime') = DATE('now', 'localtime').
   - "Este mes": fecha >= strftime('%s', 'now', 'start of month'). NUNCA uses DATE('now') para "este mes".
4. Config del sistema se consulta con SQL en tabla "config".
5. UNA sola sentencia por llamada a la herramienta.
6. Si tenes muchos resultados, resume la info clave.

## Respuesta final
Cuando ya tengas todos los datos que necesitás, respondé en lenguaje natural y amable. NUNCA uses JSON o llaves sueltas en el texto plano, EXCEPTO cuando emitas bloques especiales autorizados (${B3}chart, ${B3}crear_producto, ${B3}crear_recordatorio, ${B3}cambiar_modulo, ${B3}guardar_memoria o ${B3}crear_proveedor).
- Presenta resultados como frases naturales ("Hoy vendiste $45.000 en 12 ventas").
- Si hay mucha info, resume en lista simple.

## Graficos
Al FINAL del texto, si los datos se prestan, inclui un bloque:
${B3}chart
{"tipo":"barra","titulo":"Ventas por dia","categorias":["Lun","Mar","Mie"],"valores":[12000,18500,15000]}
${B3}
Tipos: "barra", "linea", "torta". Max 12 categorias. Solo si aporta valor.

${reglasComunes}

${seccionGastos}

${reglasModulos}

${seccionResumen}

${seccionMemoria}

${reglasCreacion}

${seccionRecordatorios}

${reglasMemoria}

${seccionProveedor}

${seccionBloquesAutorizados}

${reglasVoz}

${manual}

${schema}`;
  }

  if (modo === 'brief') {
    return `${identidad}

Sos el asesor matutino del dueño del negocio. Con los datos agregados que te pasan, generá el "brief del día": corto, accionable y motivador.

## Estructura OBLIGATORIA (texto plano, sin JSON)
1. **Diagnóstico del día** (1-2 líneas): cómo viene el negocio (ventas recientes vs promedio, caja, alertas críticas).
2. **Hasta 3 acciones concretas** ordenadas por prioridad, una por línea, empezando con verbo ("Reponé...", "Cobrales a...", "Pagá...", "Armá un combo de...").

## Reglas
- Máximo 120 palabras en total.
- NUNCA menciones SQL, tablas, consultas ni tecnicismos.
- Si no hay alertas, igual proponé 1-2 ideas para vender más hoy.

${reglasComunes}`;
  }

  if (modo === 'informe') {
    return `${identidad}

Sos el consultor semanal del dueño del negocio. Con los datos agregados de la semana que te pasan, redactá un "informe ejecutivo semanal".

## Estructura OBLIGATORIA (texto plano con títulos simples, sin JSON)
1. **Resumen ejecutivo** (2-3 líneas): cómo estuvo la semana en una frase.
2. **Ventas**: total, tickets, ticket promedio y comparación con la semana anterior.
3. **Gastos y balance**: gastos operativos, resultado neto aproximado.
4. **Productos**: qué se vendió más, qué conviene reponer, qué está estancado.
5. **Clientes y caja**: deudas nuevas o preocupantes, estado de la caja.
6. **Recomendaciones para la próxima semana** (2-3 acciones concretas).

## Reglas
- Máximo 350 palabras en total.
- Lenguaje simple de comerciante. NUNCA menciones SQL, tablas ni tecnicismos.
- Pesos argentinos con separadores de miles.

${reglasComunes}`;
  }

  // Modo JSON (para /mensajes y /resultado)
  return `${identidad}

Tu trabajo es atender al comerciante respondiendo en tres casos:

### Caso 1: Datos del negocio
Si el usuario pregunta por numeros, reportes, stock, ventas, etc., genera una consulta SQL para obtener la respuesta.

### Caso 2: Creación interactiva de productos, recordatorios, proveedores y activación de módulos
Si el usuario quiere crear un producto, agendar un recordatorio, dar de alta un proveedor o activar/desactivar módulos con tu ayuda, respondé DIRECTAMENTE con preguntas amigables en texto plano para recopilar la información. NUNCA generes SQL para iniciar la creación ni para cambiar módulos. Cuando tengas los datos o la orden, responde con {tipo: "respuesta", texto: "... ${B3}crear_producto\\n{...}\\n${B3} ..."} o {tipo: "respuesta", texto: "... ${B3}crear_recordatorio\\n{...}\\n${B3} ..."} o {tipo: "respuesta", texto: "... ${B3}cambiar_modulo\\n{...}\\n${B3} ..."} o {tipo: "respuesta", texto: "... ${B3}crear_proveedor\\n{...}\\n${B3} ..."} para emitir la tarjeta interactiva.

### Caso 3: Como usar el sistema y soporte de voz
Si pregunta cómo hacer algo en general (abrir caja, dictado por voz, escuchar voz, etc.), responde directamente con pasos claros basandote en el manual. NUNCA generes SQL para esto.

${reglasComunes}

${seccionGastos}

${reglasModulos}

${seccionResumen}

${seccionMemoria}

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

${seccionRecordatorios}

${reglasMemoria}

${seccionProveedor}

${seccionBloquesAutorizados}

${reglasVoz}

${manual}

${schema}`;
}

// --- Servicio principal ---

// --- Fase 1: router de modelo ---
// Decide 1 sola vez por ciclo qué modelo usar. Si LLM_MODEL_PRO no está
// definido en el entorno, todo usa LLM_MODEL y el router no cambia nada.
const PREGUNTA_SIMPLE_RE =
  /(^|\b)(hola|gracias|chau|buenas|buen d[ií]a|buenas tardes|buenas noches|c[óo]mo est[aá]s|qui[eé]n sos|qui[eé]nes te|qui[eé]n te hizo)\b/i;
const PREGUNTA_COMO_HACER_RE =
  /^\s*(c[óo]mo (hago|abro|anulo|creo|registro|cobro|cierro|uso|configuro|activo|desactivo|imprimo|exporto|instalo|actualizo|programo|emito)|d[óo]nde (est[aá]|queda|puedo|se)|qu[eé] es|para qu[eé] sirve|pasos para|ayuda con)\b/i;
const PREGUNTA_PROFUNDA_RE =
  /(analiz|análisis|rentab|compar|estrateg|tendenc|pron[óo]st|predic|recomen|recomend|consejo|informe|diagn[óo]st|por qu[eé]|conviene|optimiz|planific|proyecci|balance|margen|quiebre|riesgo)/i;

export function elegirModeloParaPregunta(pregunta: string): string {
  const pro = env.LLM_MODEL_PRO?.trim();
  if (!pro) return env.LLM_MODEL;
  const p = (pregunta ?? '').trim();
  if (!p) return env.LLM_MODEL;
  // Lo profundo primero: "hola, analizá mi rentabilidad" es profundo.
  if (PREGUNTA_PROFUNDA_RE.test(p) || p.length > 600) {
    console.log(`[Router] pregunta profunda → ${pro}`);
    return pro;
  }
  if ((PREGUNTA_SIMPLE_RE.test(p) || PREGUNTA_COMO_HACER_RE.test(p)) && p.length < 300) {
    return env.LLM_MODEL;
  }
  return env.LLM_MODEL;
}

function ultimoMensajeUsuario(mensajes: Array<{ role: string; content: string }>): string {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const m = mensajes[i];
    if (m?.role === 'user' && m.content.trim().length > 0) {
      return m.content;
    }
  }
  return '';
}

// --- Auditoría anti-razonamiento visible (observabilidad, no modifica nada) ---
// Si el texto final contiene marcadores de deliberación interna, se loguea
// para enterarnos por los logs del servidor antes que por un comerciante.
export function auditarTextoFinal(origen: string, texto: string): void {
  if (!texto) return;
  const marcadores = detectarDeliberacion(texto);
  if (marcadores.length > 0) {
    console.warn('[Binny-auditoria] posible razonamiento filtrado', {
      origen,
      marcadores,
      preview: texto.slice(0, 300),
    });
  }
}

// --- Guardián anti-promesa-falsa (Etapa 1) ---
// Detecta cuando el modelo promete una tarjeta ("revisá la tarjeta", "hacé
// clic en confirmar") pero no emitió ningún bloque autorizado. En ese caso se
// hace UN reintento con feedback explícito; si persiste, se loguea.

const FENCES_AUTORIZADOS = [
  'crear_producto', 'crear-producto', 'producto_crear',
  'crear_recordatorio', 'crear-recordatorio', 'recordatorio_crear',
  'crear_gasto', 'crear-gasto', 'gasto_crear',
  'cambiar_modulo', 'cambiar-modulo', 'modulos_sistema', 'activar_modulo',
  'guardar_memoria', 'guardar-memoria', 'memoria_guardar', 'recordar_dato',
  'crear_proveedor', 'crear-proveedor', 'proveedor_crear', 'nuevo_proveedor',
  'chart', 'whatsapp', 'mensaje',
];
// NOTA: crear_compra fue eliminado de la lista a propósito: Binny NO crea
// compras. Si el modelo promete una tarjeta de compra sin bloque (o con un
// bloque inventado), el guardián lo detecta y lo redirige al camino manual.

const RE_TARJETA_MENCION =
  /tarjeta que aparece|tarjeta de (ac[áa] )?arriba|tarjeta de abajo|tarjeta ac[áa]|tarjeta aqu[íi]|ficha que aparece|revis[áa] (los datos en |la )?(la )?tarjeta/i;
const RE_CLIC_ACCION = /hac[ée] clic en \*{0,2}(confirmar|guardar|registrar)/i;
const RE_TARJETA_O_FICHA = /tarjeta|ficha/i;
// "Confirmar y Crear X": la instrucción de confirmación de una tarjeta. Solo
// es posible si X es una entidad CON tarjeta (lista cerrada).
const RE_CONFIRMAR_CREAR = /confirmar y crear ([a-záéíóúñ]+)/i;
const ENTIDADES_CON_TARJETA = ['producto', 'proveedor', 'recordatorio', 'gasto'];

// Marcadores de promesa FUTURA o condicional: si aparecen junto a la mención,
// la tarjeta todavía no debería existir y NO es una promesa falsa.
const RE_MARCA_FUTURO =
  /cuando|enseguida|te genero|te voy a|voy a mostrar|en cuanto|despu[ée]s|luego|apenas|si (me|quer[ée]s)/i;

function fencesEmitidos(texto: string): string[] {
  const out: string[] = [];
  const re = /```(\w[\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const lang = m[1].toLowerCase();
    if (lang !== 'json') out.push(lang);
  }
  return out;
}

function oracionDe(texto: string, index: number, len: number): string {
  const antes = texto.slice(0, index);
  const despues = texto.slice(index + len);
  const ini = Math.max(antes.lastIndexOf('.'), antes.lastIndexOf('!'), antes.lastIndexOf('?'), antes.lastIndexOf('\n')) + 1;
  let finRel = despues.search(/[.!?\n]/);
  finRel = finRel === -1 ? texto.length : index + len + finRel;
  return texto.slice(ini, finRel);
}

export function prometeSinTarjeta(texto: string): boolean {
  if (!texto || texto.length < 20) return false;
  // 0. "Confirmar y Crear X" de entidad SIN tarjeta (combo, cliente,
  // promoción, compra...): promesa imposible, la tarjeta nunca puede existir.
  // Si X tiene tarjeta, sigue el análisis normal (vale con fence autorizado).
  const mCrear = RE_CONFIRMAR_CREAR.exec(texto);
  if (mCrear?.index !== undefined && mCrear[1]) {
    const ent = mCrear[1].toLowerCase();
    if (!ENTIDADES_CON_TARJETA.some((e) => ent.startsWith(e))) {
      return !fencesEmitidos(texto).some((f) => FENCES_AUTORIZADOS.includes(f));
    }
  }
  // 1. Mención directa de tarjeta ya visible ("la tarjeta que aparece...").
  let oracion = '';
  const m = RE_TARJETA_MENCION.exec(texto);
  if (m && m.index !== undefined) {
    oracion = oracionDe(texto, m.index, m[0].length);
  } else {
    // 2. "Hacé clic en Confirmar/Guardar" SOLO vale si esa misma oración
    // habla de una tarjeta: en el camino manual ("Compras > ... > Confirmar")
    // es una instrucción legítima sin tarjeta.
    const c = RE_CLIC_ACCION.exec(texto);
    if (!c || c.index === undefined) return false;
    oracion = oracionDe(texto, c.index, c[0].length);
    if (!RE_TARJETA_O_FICHA.test(oracion)) return false;
  }
  // Promesa futura/condicional ("te genero la tarjeta cuando..."): legítima,
  // la tarjeta todavía no debería existir. Solo se mira la MISMA oración.
  if (RE_MARCA_FUTURO.test(oracion)) return false;
  return !fencesEmitidos(texto).some((f) => FENCES_AUTORIZADOS.includes(f));
}

// Marcadores de disculpa del reintento: si el modelo disculpa en vez de
// corregir, el reintento se descarta y se conserva el original.
const RE_DISCULPA = /disculp|toda la raz[óo]n|perd[óo]n/i;

export function esDisculpa(texto: string): boolean {
  return RE_DISCULPA.test(texto ?? '');
}

// --- Detección de JSON suelto de entidad (sin fence) ---
// El modelo a veces pega un objeto JSON crudo en el texto (ej: datos de un
// combo con items y producto_id) en vez de usar un bloque fence autorizado.
// Eso se renderiza como texto ilegible y la "tarjeta" prometida nunca aparece.

const CLAVES_NOMBRE_ENTIDAD = ['nombre', 'titulo', 'concepto', 'contenido'];

function entidadDeJson(obj: any): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const ks = new Set(Object.keys(obj).map((k) => String(k).toLowerCase()));
  const tiene = (...candidatas: string[]) => candidatas.some((k) => ks.has(k));
  const tieneNombre = CLAVES_NOMBRE_ENTIDAD.some((k) => ks.has(k));
  if (ks.has('items') && (tieneNombre || ks.has('precio_venta'))) return 'combo';
  if (ks.has('cambios')) return 'modulo';
  if (!tieneNombre) return null;
  if (tiene('codigo_interno', 'codigo_barras', 'precio_costo', 'precio_venta', 'producto_id')) return 'producto';
  if ((ks.has('fecha') || ks.has('hora')) && (ks.has('titulo') || ks.has('descripcion'))) return 'recordatorio';
  if (ks.has('concepto') && ks.has('monto')) return 'gasto';
  if (tiene('proveedor_id', 'proveedor_nombre', 'cuit', 'razon_social')) return 'proveedor';
  if (tiene('documento', 'telefono', 'email', 'direccion')) return 'cliente';
  if (ks.has('contenido')) return 'memoria';
  return null;
}

export interface JsonSuelto {
  raw: string;
  entidad: string;
}

/**
 * Busca objetos JSON sueltos (fuera de bloques fence ```) con forma de
 * entidad del sistema. Retorna el primero con su texto crudo y la entidad
 * detectada, o null si no hay.
 */
export function jsonSueltoEntidad(texto: string): JsonSuelto | null {
  if (!texto || texto.length < 20) return null;
  // Blanquear bloques fenceados (con longitud preservada para alinear índices).
  const sinFences = texto
    .replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length))
    .replace(/```[\s\S]*$/, (m) => ' '.repeat(m.length));
  let i = 0;
  while (i < sinFences.length) {
    if (sinFences[i] !== '{') {
      i++;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < sinFences.length; j++) {
      const c = sinFences[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === '{') {
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth === 0 && j < sinFences.length) {
      const raw = texto.slice(i, j + 1);
      try {
        const entidad = entidadDeJson(JSON.parse(raw));
        if (entidad) return { raw, entidad };
      } catch {
        // No es JSON válido, seguir buscando
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return null;
}

const CAMINO_MANUAL: Record<string, string> = {
  combo: 'Combos > Nuevo Combo',
  producto: 'Productos > Nuevo Producto',
  recordatorio: 'la campana > Nuevo Recordatorio',
  gasto: 'Gastos > Nuevo Gasto',
  proveedor: 'Proveedores > Nuevo Proveedor',
  cliente: 'Clientes > Nuevo Cliente',
  modulo: 'Configuración > Módulos',
  memoria: 'Configuración > Asistente Binny',
};

/**
 * Fallback determinista (sin LLM): quita el JSON suelto del texto y anexa
 * el camino manual correspondiente. Si no hay JSON suelto, devuelve el texto
 * intacto. Nunca inventa contenido.
 */
export function aplicarFallbackManual(texto: string): string {
  const hallado = jsonSueltoEntidad(texto);
  if (!hallado) return texto;
  const sinJson = texto.split(hallado.raw).join('').replace(/\n{3,}/g, '\n\n').trim();
  const camino = CAMINO_MANUAL[hallado.entidad];
  const linea = camino
    ? `\n\nNota: para darlo de alta hacelo desde ${camino}.`
    : `\n\nNota: eso se gestiona desde la pantalla correspondiente del sistema.`;
  return `${sinJson}${linea}`.trim();
}

/**
 * Un reintento no-streaming cuando el texto final promete una tarjeta que no
 * existe. Retorna el texto corregido (con bloque) o null si persiste el fallo.
 * Los tokens del reintento se devuelven para acumularlos.
 */
export async function reintentarTarjetaFaltante(
  mensajesPrevios: ChatMessage[],
  textoFallido: string,
  modelo: string,
): Promise<{ texto: string; tokens: TokensProactivo } | null> {
  const mensajes: ChatMessage[] = [
    ...mensajesPrevios,
    { role: 'assistant', content: textoFallido },
    {
      role: 'user',
      content:
        'Tu respuesta anterior mencionó una tarjeta interactiva visible sin incluir su bloque de código, o pegó un JSON suelto en el texto. Hacé UNA de estas dos cosas: (1) si la tarjeta corresponde, reemití tu respuesta completa incluyendo el bloque exacto (``` + nombre + JSON + ```); (2) si la tarjeta NO corresponde, reescribí tu respuesta como guía manual paso a paso, sin mencionar ninguna tarjeta. Nunca pegues objetos JSON sueltos en el texto: o van dentro de un bloque fence autorizado, o no van. En ningún caso te disculpes ni menciones este aviso.',
    },
  ];
  const { respuesta, tokens } = await llamarLLM(mensajes, { jsonMode: false, model: modelo });
  if (respuesta.tipo !== 'respuesta') return null;
  const texto = respuesta.texto ?? '';
  // Aceptar solo si corrigió de verdad: emitió tarjeta autorizada, o reescribió
  // sin prometer tarjeta y sin JSON suelto. Una disculpa ("tienes toda la
  // razón...") se descarta para conservar el original: es peor que la inicial.
  // Un JSON suelto persistente también se rechaza (lo limpia el fallback manual).
  const fences = fencesEmitidos(texto);
  if (fences.some((f) => FENCES_AUTORIZADOS.includes(f))) return { texto, tokens };
  if (jsonSueltoEntidad(texto)) return null;
  if (!prometeSinTarjeta(texto) && !esDisculpa(texto)) return { texto, tokens };
  return null;
}

// --- Anti-thrashing: freno determinista a consultas SQL repetidas ---
// Si el modelo pide tool calls equivalentes a SQL ya ejecutados en este ciclo
// (mismo esqueleto + misma descripción), no se los reenvía al desktop: se le
// pide una respuesta final con lo que ya tiene.
// (El prompt también lo prohíbe, pero esto lo garantiza en código.)

function esqueletoDe(sql: string): string {
  return sql
    .toLowerCase()
    .replace(/'[^']*'/g, '?')
    .replace(/\b\d+(\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .replace(/;$/, '')
    .trim();
}

function tokensDe(sql: string): string[] {
  return sql.toLowerCase().split(/[^a-z0-9_áéíóúñ]+/).filter((t) => t.length > 0);
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sb) if (sa.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

interface LlamadaPrevia {
  sql: string;
  esqueleto: string;
  descripcion: string;
}

function llamadasPrevias(mensajes: AgenteMessage[]): LlamadaPrevia[] {
  const out: LlamadaPrevia[] = [];
  for (const m of mensajes) {
    for (const tc of m.tool_calls ?? []) {
      try {
        const args = JSON.parse(tc.function.arguments) as { sql?: unknown; descripcion?: unknown };
        if (typeof args.sql === 'string' && args.sql.trim().length > 0) {
          out.push({
            sql: args.sql,
            esqueleto: esqueletoDe(args.sql),
            descripcion: typeof args.descripcion === 'string' ? args.descripcion.trim().toLowerCase() : '',
          });
        }
      } catch {
        // tool call malformado: lo maneja el desktop
      }
    }
  }
  return out;
}

/**
 * ¿El lote repite consultas ya hechas? true solo si TODOS los SQL del lote
 * equivalen a alguno previo: igualdad exacta, o esqueleto ≥90% similar con
 * la MISMA descripción (evita falsos positivos tipo "hoy vs ayer", que
 * comparten esqueleto pero describen distinto).
 */
function loteEsDuplicado(toolCalls: AgenteToolCall[], previas: LlamadaPrevia[]): boolean {
  if (toolCalls.length === 0 || previas.length === 0) return false;
  return toolCalls.every((tc) => {
    let sql = '';
    let descripcion = '';
    try {
      const args = JSON.parse(tc.argumentos) as { sql?: unknown; descripcion?: unknown };
      if (typeof args.sql !== 'string' || args.sql.trim().length === 0) return false;
      sql = args.sql;
      descripcion = typeof args.descripcion === 'string' ? args.descripcion.trim().toLowerCase() : '';
    } catch {
      return false;
    }
    const norm = sql.toLowerCase().replace(/\s+/g, ' ').replace(/;$/, '').trim();
    const esq = esqueletoDe(sql);
    return previas.some(
      (p) =>
        p.sql.toLowerCase().replace(/\s+/g, ' ').replace(/;$/, '').trim() === norm ||
        (jaccard(tokensDe(esq), tokensDe(p.esqueleto)) >= 0.9 &&
          descripcion.length > 0 &&
          descripcion === p.descripcion),
    );
  });
}

// --- Guard de entidad: freno determinista a altas de entidades prohibidas ---
// Binny NO puede crear combos, clientes, promociones ni compras (no hay tool
// ni tarjeta para eso). Si el modelo igual emite un tool call de alta cuando
// el comerciante pidió una de esas entidades, no se lo reenvía al desktop:
// se fuerza una respuesta final con el camino manual. (El prompt también lo
// prohíbe, pero esto lo garantiza en código: sin esto, el modelo improvisa
// con crear_producto y el daño llega al usuario.)
//
// Diseño seguro: el disparo exige verbo de creación + entidad juntos en el
// último mensaje del usuario ("preparame un combo", "creá un cliente"). Un
// producto legítimamente llamado "Combo x6" o una pregunta de datos ("¿qué
// combos vendo más?") NO disparan el guard.

const TOOLS_ALTA = ['crear_producto', 'crear_proveedor', 'crear_recordatorio', 'crear_gasto'];

// Verbos de alta en infinitivo/raíz (sin acento a propósito: matchea
// "creá", "crear", "preparemos", "armame", "haceme", "generame", etc.).
const VERBO_ALTA = '(cre|arm|prepar|hac|gener|dame|quiero|necesito|sug)';
const RE_INTENTO_ENTIDAD: Array<{ entidad: string; patron: RegExp }> = [
  {
    entidad: 'combo',
    patron: new RegExp(
      `\\b${VERBO_ALTA}\\w*\\b[^.?!\\n]{0,80}\\bcombos?\\b|\\bcombos?\\b[^.?!\\n]{0,80}\\b(cre|arm|prepar|hac|nuev)\\w*\\b`,
      'i',
    ),
  },
  {
    entidad: 'cliente',
    patron: new RegExp(
      `\\b${VERBO_ALTA}\\w*\\b[^.?!\\n]{0,80}\\bclientes?\\b|\\b(nuevo|nueva|alta)\\b[^.?!\\n]{0,40}\\bclientes?\\b`,
      'i',
    ),
  },
  {
    entidad: 'promocion',
    patron: new RegExp(`\\b${VERBO_ALTA}\\w*\\b[^.?!\\n]{0,80}\\b(promoci|descuento)[a-z]*\\b`, 'i'),
  },
  {
    entidad: 'compra',
    patron: new RegExp(
      '\\b(cre|arm|prepar|carg|registr|hac)\\w*\\b[^.?!\\n]{0,80}\\bcompras?\\b|\\border\\b[^.?!\\n]{0,40}\\bcompras?\\b',
      'i',
    ),
  },
];

const CAMINO_ENTIDAD_PROHIBIDA: Record<string, string> = {
  combo: CAMINO_MANUAL.combo,
  cliente: CAMINO_MANUAL.cliente,
  promocion: 'la pantalla correspondiente del sistema',
  compra: 'Compras > Nueva Compra',
};

/** ¿Algún mensaje del usuario pide crear una entidad prohibida? Se pasa el
 * texto de TODOS los mensajes de usuario del ciclo (unidos por \n): en una
 * conversación de varios turnos el intento ("preparemos un combo") queda en
 * un turno anterior al que emite la tarjeta ("prefiero la opción 1"). */
export function intentoEntidadProhibida(textoUsuarios: string): string | null {
  const texto = textoUsuarios ?? '';
  if (texto.length < 4) return null;
  // "creer" no es "crear": "¿creés que el combo rinde?" es pedir opinión,
  // no un alta. Se blanquean esas construcciones antes de analizar.
  const limpio = texto.replace(/\bcre[eé]s?\s+que\b|\bcreen\s+que\b|\bcreo\s+que\b|\bcre[ií]a\s+que\b/gi, ' ');
  for (const { entidad, patron } of RE_INTENTO_ENTIDAD) {
    if (patron.test(limpio)) return entidad;
  }
  return null;
}

export interface DesvioEntidad {
  entidad: string;
  tool: string;
  camino: string;
}

// --- Intención de memoria (Ítem 1: memoria automática) ---
// ¿El usuario contó un dato estable que Binny debería anotar? Patrones con
// hecho ("mi proveedor ... es ...", "abrimos ... a las ...", "anotá que ...").
// A propósito NO incluye "recordame + infinitivo" ("recordame llamar"): eso
// es un recordatorio (crear_recordatorio), no una memoria.
const RE_INTENTO_MEMORIA = [
  /\b(anot|guard)[áa]?(?:te|me|lo|la|nos)?\b[^.?!\n]{0,30}\b(que|en\s+tu\s+memoria)\b/i,
  /\bmi\s+(proveedor|proveedora|distribuidor[ae]?|horario|rubro|tel[eé]fono|direcci[oó]n|nombre|contacto|encargado|repartidor[a]?|socio)\b[^.?!\n]{0,60}\bes\b/i,
  /\b(abrimos|cerramos|atiendo|atendemos|trabajo|trabajamos)\b[^.?!\n]{0,60}\b(a\s+las|de\s+\d|hasta)\b/i,
];

export function intentoMemoria(textoUsuarios: string): boolean {
  const texto = textoUsuarios ?? '';
  if (texto.length < 4) return false;
  return RE_INTENTO_MEMORIA.some((re) => re.test(texto));
}

/**
 * Recorte con gracia del historial del agente (nunca 400 al usuario).
 * Si supera HISTORIAL_MAX_AGENTE: conserva siempre el primer mensaje de
 * usuario (la pregunta original) + la cola más reciente, descartando desde
 * el inicio únicamente grupos completos (un assistant con tool_calls viaja
 * con todos sus resultados; un resultado huérfano se descarta). Retorna el
 * historial recortado y cuántos items se quitaron (0 si no hubo recorte).
 */
export function recortarHistorialAgente(historial: MensajeAgenteDTO[]): {
  historial: MensajeAgenteDTO[];
  recortados: number;
} {
  if (historial.length <= HISTORIAL_MAX_AGENTE) return { historial, recortados: 0 };
  const idxPrimero = historial.findIndex((m) => m.role === 'user');
  const primero = idxPrimero >= 0 ? historial[idxPrimero] : null;
  let cola = historial.filter((_, i) => i !== idxPrimero).slice(-(HISTORIAL_MAX_AGENTE - 1));
  // Estabilizar el borde: nunca arrancar con un tool huérfano ni con un
  // assistant cuyos tool_calls no tengan todos sus resultados presentes.
  let estable = false;
  while (!estable && cola.length > 0) {
    estable = true;
    const m0 = cola[0];
    if (m0.role === 'tool') {
      cola = cola.slice(1);
      estable = false;
      continue;
    }
    if (m0.role === 'assistant' && (m0.tool_calls?.length ?? 0) > 0) {
      const presentes = new Set(
        cola.filter((m) => m.role === 'tool' && m.tool_call_id).map((m) => m.tool_call_id as string),
      );
      const faltan = (m0.tool_calls ?? []).some((tc) => !presentes.has(tc.id));
      if (faltan) {
        cola = cola.slice(1);
        estable = false;
      }
    }
  }
  const final = primero ? [primero, ...cola] : cola;
  return { historial: final, recortados: historial.length - final.length };
}

/**
 * Fences problemáticos en un texto cuando el usuario pidió una entidad
 * prohibida: fences de alta (crear_producto y variantes) E inventados
 * (crear_combo, etc.). Los fences seguros (chart, whatsapp, mensaje) nunca
 * se tocan: un gráfico en una conversación de combos es legítimo.
 */
const FENCE_ALTA_NORM = new Set(['crearproducto', 'crearproveedor', 'crearrecordatorio', 'creargasto']);
const FENCES_SEGUROS = new Set(['chart', 'whatsapp', 'mensaje']);

function normFence(f: string): string {
  return f.toLowerCase().replace(/[-_]/g, '');
}

export function fencesEntidadBloqueada(texto: string): string[] {
  return fencesEmitidos(texto).filter(
    (f) => !FENCES_SEGUROS.has(normFence(f)) && (FENCE_ALTA_NORM.has(normFence(f)) || !FENCES_AUTORIZADOS.includes(f)),
  );
}

/**
 * Quita del texto los fences indicados (con su JSON) y anexa el camino
 * manual de la entidad. Último recurso determinista cuando el reintento
 * persiste: el usuario nunca ve ni el bloque inventado ni la tarjeta ajena.
 */
export function quitarFencesBloqueados(texto: string, entidad: string, fences: string[]): string {
  const normas = new Set(fences.map(normFence));
  const sinFences = texto
    .replace(/```(\w[\w-]*)[\s\S]*?```/g, (m, lang) => (normas.has(normFence(String(lang))) ? '' : m))
    .replace(/```(\w[\w-]*)[\s\S]*$/g, (m, lang) => (normas.has(normFence(String(lang))) ? '' : m))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const camino = CAMINO_ENTIDAD_PROHIBIDA[entidad] ?? 'la pantalla correspondiente del sistema';
  return `${sinFences}\n\nNota: eso no se puede crear por acá; se hace en ${camino}.`.trim();
}

/**
 * Reintento no-streaming cuando el texto final trae un fence de alta para
 * una entidad prohibida (ej: crear_producto para un combo). Acepta solo una
 * reescritura limpia como guía manual; si persiste, retorna null para que el
 * llamador aplique el fallback determinista.
 */
async function reintentarEntidadBloqueada(
  mensajesPrevios: ChatMessage[],
  textoFallido: string,
  entidad: string,
  camino: string,
  modelo: string,
): Promise<{ texto: string; tokens: TokensProactivo } | null> {
  const mensajes: ChatMessage[] = [
    ...mensajesPrevios,
    { role: 'assistant', content: textoFallido },
    {
      role: 'user',
      content:
        `Tu respuesta incluyó un bloque de alta cuando el comerciante pidió un/a ${entidad}. Eso está PROHIBIDO: ${entidad} NO tiene tarjeta y JAMÁS uses la de otra entidad en su lugar. Reescribí tu respuesta como guía manual paso a paso explicando que se hace en ${camino}, SIN bloques de código, SIN JSON y SIN mencionar tarjetas. En ningún caso te disculpes ni menciones este aviso.`,
    },
  ];
  const { respuesta, tokens } = await llamarLLM(mensajes, { jsonMode: false, model: modelo });
  if (respuesta.tipo !== 'respuesta') return null;
  const texto = respuesta.texto ?? '';
  if (fencesEntidadBloqueada(texto).length > 0) return null;
  if (jsonSueltoEntidad(texto)) return null;
  if (prometeSinTarjeta(texto) || esDisculpa(texto)) return null;
  return { texto, tokens };
}

/**
 * ¿El lote de tool calls intenta dar de alta una entidad prohibida?
 * Solo cuando el usuario pidió crearla (verbo + entidad en sus mensajes) y
 * la tool es de alta. Retorna el desvío o null.
 */
export function desvioEntidadProhibida(
  toolCalls: Array<{ nombre?: string }>,
  textoUsuarios: string,
): DesvioEntidad | null {
  const alta = toolCalls.find((t) => t.nombre && TOOLS_ALTA.includes(t.nombre));
  if (!alta?.nombre) return null;
  const entidad = intentoEntidadProhibida(textoUsuarios);
  if (!entidad) return null;
  return {
    entidad,
    tool: alta.nombre,
    camino: CAMINO_ENTIDAD_PROHIBIDA[entidad] ?? 'la pantalla correspondiente del sistema',
  };
}

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
      { role: 'system', content: construirPromptSistema('json', data.contexto) },
    ];

    for (const msg of data.historial.slice(-10)) {
      const rol = msg.rol === 'asistente' ? 'assistant' : msg.rol === 'sistema' ? 'system' : 'user';
      mensajes.push({ role: rol as 'user' | 'assistant' | 'system', content: msg.contenido });
    }

    mensajes.push({ role: 'user', content: data.pregunta });

    // Fase 1: router de modelo (1 decisión por ciclo)
    const modelo = elegirModeloParaPregunta(data.pregunta);

    let respuesta: RespuestaLLM;
    let tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens: number } = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };

    const MAX_INTENTOS = 3;

    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
      try {
        const resultado = await llamarLLM(mensajes, { jsonMode: true, model: modelo });
        respuesta = resultado.respuesta;
        tokens.prompt_tokens += resultado.tokens.prompt_tokens;
        tokens.completion_tokens += resultado.tokens.completion_tokens;
        tokens.total_tokens += resultado.tokens.total_tokens;
        tokens.cached_tokens += resultado.tokens.cached_tokens;
      } catch (error) {
        await decrementarMensajes(lic.id);
        throw error;
      }

      if (respuesta.tipo === 'respuesta') break;

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
    if (respuesta!.tipo === 'consulta') {
      const { sql: sqlNormalizado } = normalizarSQL(respuesta!.sql);
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

    if (respuesta!.tipo === 'respuesta') {
      auditarTextoFinal('preguntar', respuesta!.texto);
      if (prometeSinTarjeta(respuesta!.texto) || jsonSueltoEntidad(respuesta!.texto)) {
        console.warn('[Binny-guardian] promesa sin tarjeta o JSON suelto en preguntar, reintentando una vez');
        try {
          const retry = await reintentarTarjetaFaltante(mensajes, respuesta!.texto, modelo);
          if (retry) {
            if (retry.tokens.total_tokens > 0) {
              await acumularTokens(lic.id, retry.tokens);
            }
            respuesta = { tipo: 'respuesta', texto: retry.texto };
            tokens.prompt_tokens += retry.tokens.prompt_tokens;
            tokens.completion_tokens += retry.tokens.completion_tokens;
            tokens.total_tokens += retry.tokens.total_tokens;
            tokens.cached_tokens += retry.tokens.cached_tokens;
          } else {
            // El reintento no corrigió: fallback determinista (quita el JSON
            // suelto y anexa el camino manual) en vez de dejar la promesa rota.
            const saneado = aplicarFallbackManual(respuesta!.texto);
            if (saneado !== respuesta!.texto) {
              console.warn('[Binny-guardian] fallback manual aplicado en preguntar');
              respuesta = { tipo: 'respuesta', texto: saneado };
            }
          }
        } catch (e) {
          console.warn('[Binny-guardian] falló el reintento:', e);
        }
      }
    }
    return { ...respuesta!, tokens, uso };
  }

  async resultado(data: ResultadoConsultaDTO): Promise<RespuestaLLM> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
    const mensajes = construirMensajesResultado(data);

    const { respuesta, tokens } = await llamarLLM(mensajes);

    // Acumular tokens en DB (esta llamada no incrementa mensajes, solo tokens)
    if (tokens.total_tokens > 0) {
      await acumularTokens(lic.id, tokens);
    }

    if (respuesta.tipo === 'respuesta') {
      auditarTextoFinal('resultado', respuesta.texto);
      if (prometeSinTarjeta(respuesta.texto) || jsonSueltoEntidad(respuesta.texto)) {
        console.warn('[Binny-guardian] promesa sin tarjeta o JSON suelto en resultado, reintentando una vez');
        try {
          const retry = await reintentarTarjetaFaltante(mensajes, respuesta.texto, env.LLM_MODEL);
          if (retry) {
            if (retry.tokens.total_tokens > 0) {
              await acumularTokens(lic.id, retry.tokens);
            }
            tokens.prompt_tokens += retry.tokens.prompt_tokens;
            tokens.completion_tokens += retry.tokens.completion_tokens;
            tokens.total_tokens += retry.tokens.total_tokens;
            tokens.cached_tokens += retry.tokens.cached_tokens;
            return { tipo: 'respuesta', texto: retry.texto, tokens };
          }
          const saneado = aplicarFallbackManual(respuesta.texto);
          if (saneado !== respuesta.texto) {
            console.warn('[Binny-guardian] fallback manual aplicado en resultado');
            return { tipo: 'respuesta', texto: saneado, tokens };
          }
        } catch (e) {
          console.warn('[Binny-guardian] falló el reintento:', e);
        }
      }
    }
    return { ...respuesta, tokens };
  }

  async uso(data: UsoConsultaDTO): Promise<UsoDTO> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
    return obtenerUso(lic.id);
  }

  async procesarFacturaOcr(data: FacturaOcrRequestDTO): Promise<FacturaOcrResponseDTO> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);

    const cantidadMensajes = env.CHAT_MENSAJES_POR_OCR;
    const usoCheck = await incrementarMensajes(lic.id, cantidadMensajes);
    if (!usoCheck) {
      const limite = await obtenerLimiteChat(lic.id);
      httpError(
        `Alcanzaste tu límite mensual de consultas (${limite}). El escaneo de facturas requiere ${cantidadMensajes} consultas. Se renueva el día 1 del próximo mes.`,
        429,
      );
    }
    const uso = usoCheck!;

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

    const mensajes: ChatMessageVision[] = [
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
      } else if (jsonLimpio.startsWith('```')) {
        jsonLimpio = jsonLimpio.slice(3);
      }
      if (jsonLimpio.endsWith('```')) {
        jsonLimpio = jsonLimpio.slice(0, -3);
      }
      jsonLimpio = jsonLimpio.trim();

      const parsed = JSON.parse(jsonLimpio);

      const items: FacturaOcrItemDTO[] = Array.isArray(parsed.items)
        ? parsed.items.map((it: any) => ({
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

      const resultado: FacturaOcrResultadoDTO = {
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
    } catch (err) {
      await decrementarMensajes(lic.id, cantidadMensajes);
      console.error('[Factura OCR Error]:', err);
      throw httpError(`Error al procesar la imagen de la factura con IA: ${err instanceof Error ? err.message : String(err)}`, 500);
    }
  }

  async *preguntarStream(data: PreguntarDTO): AsyncGenerator<{ type: string; texto?: string; tokens?: any; respuesta?: any; uso?: UsoDTO }> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);

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
      { role: 'system', content: construirPromptSistema('fase1', data.contexto) },
    ];

    for (const msg of data.historial.slice(-10)) {
      const rol = msg.rol === 'asistente' ? 'assistant' : msg.rol === 'sistema' ? 'system' : 'user';
      mensajes.push({ role: rol as 'user' | 'assistant' | 'system', content: msg.contenido });
    }

    mensajes.push({ role: 'user', content: data.pregunta });

    // Fase 1: router de modelo (1 decisión por ciclo)
    const modelo = elegirModeloParaPregunta(data.pregunta);

    let tokensFinales: any = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };
    let textoAcumulado = '';

    for await (const evento of llamarLLMStream(mensajes, { centinela: '@CONSULTA', model: modelo })) {
      if (evento.type === 'chunk' && evento.texto) {
        textoAcumulado += evento.texto;
        yield { type: 'chunk', texto: evento.texto };
      } else if (evento.type === 'consulta' && evento.respuesta && evento.respuesta.tipo === 'consulta') {
        const { sql: sqlNormalizado } = normalizarSQL(evento.respuesta.sql);
        const validacion = validarSQL(sqlNormalizado);

        if (validacion.valido) {
          yield { type: 'consulta', respuesta: { ...evento.respuesta, sql: sqlNormalizado, tokens: tokensFinales, uso } };
        } else {
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
            const retry = await llamarLLM(mensajes, { jsonMode: true, model: modelo });
            tokensFinales.prompt_tokens += retry.tokens.prompt_tokens;
            tokensFinales.completion_tokens += retry.tokens.completion_tokens;
            tokensFinales.total_tokens += retry.tokens.total_tokens;
            tokensFinales.cached_tokens += retry.tokens.cached_tokens;
            if (retry.respuesta.tipo === 'consulta') {
              const { sql: sqlReintentado } = normalizarSQL(retry.respuesta.sql);
              if (validarSQL(sqlReintentado).valido) {
                yield { type: 'consulta', respuesta: { ...retry.respuesta, sql: sqlReintentado, tokens: tokensFinales, uso } };
              } else {
                yield { type: 'error', texto: 'No pude generar una consulta válida para eso. ¿Podés reformular la pregunta?' };
              }
            } else {
              yield { type: 'error', texto: 'No pude generar la consulta. ¿Podés reformular la pregunta?' };
            }
          } catch {
            yield { type: 'error', texto: 'No pude generar la consulta. ¿Podés reformular la pregunta?' };
          }
        }
      } else if (evento.type === 'done') {
        tokensFinales = evento.tokens ?? tokensFinales;
        // Guardián anti-tarjeta-fantasma (Etapa 1 también en streaming): si el
        // texto promete una tarjeta sin su bloque, reintentar UNA vez con
        // feedback y reemitir el texto corregido como evento 'reemplazo' (el
        // desktop lo persiste en lugar de lo acumulado por chunks).
        let textoFinal = textoAcumulado;
        if (prometeSinTarjeta(textoAcumulado) || jsonSueltoEntidad(textoAcumulado)) {
          console.warn('[Binny-guardian] promesa sin tarjeta o JSON suelto en preguntarStream, reintentando una vez');
          try {
            const retry = await reintentarTarjetaFaltante(mensajes, textoAcumulado, modelo);
            if (retry) {
              textoFinal = retry.texto;
              tokensFinales.prompt_tokens += retry.tokens.prompt_tokens;
              tokensFinales.completion_tokens += retry.tokens.completion_tokens;
              tokensFinales.total_tokens += retry.tokens.total_tokens;
              tokensFinales.cached_tokens += retry.tokens.cached_tokens;
            } else {
              const saneado = aplicarFallbackManual(textoAcumulado);
              if (saneado !== textoAcumulado) {
                console.warn('[Binny-guardian] fallback manual aplicado en preguntarStream');
                textoFinal = saneado;
              } else {
                console.warn('[Binny-guardian] promesa sin tarjeta persistente en preguntarStream');
              }
            }
          } catch (e) {
            console.warn('[Binny-guardian] falló el reintento en preguntarStream:', e);
          }
        }
        if (textoFinal !== textoAcumulado) {
          yield { type: 'reemplazo', texto: textoFinal };
        }
        auditarTextoFinal('preguntarStream', textoFinal);
        yield { type: 'done', texto: textoFinal, tokens: tokensFinales, uso };
      } else if (evento.type === 'error') {
        yield { type: 'error', texto: evento.texto };
      }
    }

    if (tokensFinales.total_tokens > 0) {
      await acumularTokens(lic.id, tokensFinales);
    }
  }

  // --- Agente multi-paso (function calling) ---
  //
  // El backend es stateless: no guarda sesiones entre pasos. El desktop (Rust)
  // orquesta el ciclo: ejecuta la herramienta localmente contra su SQLite y
  // reenvía el array completo de mensajes en cada llamada a `continuarAgente`.
  // La validación real del SQL ocurre en el desktop, que es donde se ejecuta.

  async *preguntarAgente(data: PreguntarAgenteDTO): AsyncGenerator<EventoAgenteServicio> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);

    // La cuota se cobra UNA vez por ciclo completo, no por paso.
    const usoCheck = await incrementarMensajes(lic.id);
    if (!usoCheck) {
      const limite = await obtenerLimiteChat(lic.id);
      httpError(
        `Alcanzaste tu limite mensual de ${limite} consultas del asistente. Se renueva el dia 1 del proximo mes.`,
        429,
      );
    }
    const uso = usoCheck!;

    const mensajes: AgenteMessage[] = [
      { role: 'system', content: construirPromptSistema('agente', data.contexto) },
    ];

    for (const msg of data.historial.slice(-10)) {
      const rol = msg.rol === 'asistente' ? 'assistant' : msg.rol === 'sistema' ? 'system' : 'user';
      mensajes.push({ role: rol, content: msg.contenido });
    }

    mensajes.push({ role: 'user', content: data.pregunta });

    // Fase 1: router de modelo (1 decisión por ciclo)
    const modelo = elegirModeloParaPregunta(data.pregunta);

    yield* this.streamAgente(mensajes, lic.id, uso, false, modelo);
  }

  async *continuarAgente(data: ContinuarAgenteDTO): AsyncGenerator<EventoAgenteServicio> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);

    // Sin incremento de cuota: el ciclo ya se cobró en el primer turno.
    const uso = await obtenerUso(lic.id);

    // Recorte con gracia (nunca 400): un informe complejo supera los 40
    // items legítimamente; se conserva la pregunta + grupos completos.
    const { historial: historialRecortado, recortados } = recortarHistorialAgente(data.historial);
    if (recortados > 0) {
      console.warn(`[Agente] historial recortado con gracia: ${recortados} items (ciclo largo)`);
    }

    const pasosTool = historialRecortado.filter((m) => m.role === 'tool').length;
    // Tope server-side: si el desktop ya usó todos los pasos, forzar respuesta final.
    const forzarFinal = pasosTool >= AGENTE_MAX_PASOS;

    // El mensaje del sistema se reconstruye acá con el contexto fresco;
    // el desktop solo reenvía pregunta + tool_calls + resultados.
    const mensajes: AgenteMessage[] = [
      { role: 'system', content: construirPromptSistema('agente', data.contexto) },
      ...historialRecortado.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
    ];

    // Mismo modelo que el primer turno: se clasifica sobre la pregunta
    // original (último mensaje de usuario antes de los pasos con herramientas).
    const modelo = elegirModeloParaPregunta(ultimoMensajeUsuario(mensajes));

    yield* this.streamAgente(mensajes, lic.id, uso, forzarFinal, modelo);
  }

  private async *streamAgente(
    mensajes: AgenteMessage[],
    licenciaId: string,
    uso: UsoChat,
    forzarRespuestaFinal: boolean,
    modelo: string = env.LLM_MODEL,
  ): AsyncGenerator<EventoAgenteServicio> {
    let tokensFinales: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens: number } =
      { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };

    // En el último paso forzado no se envían tools: el proveedor no puede
    // devolver tool_calls y la respuesta en texto está garantizada.
    for await (const evento of llamarLLMAgenteStream(mensajes, HERRAMIENTAS_AGENTE, { forzarRespuestaFinal, sinHerramientas: forzarRespuestaFinal, model: modelo })) {
      if (evento.type === 'chunk' && evento.texto) {
        yield { type: 'chunk', texto: evento.texto };
      } else if (evento.type === 'herramienta') {
        // Freno anti-thrashing: si TODOS los SQL del lote equivalen a consultas
        // ya ejecutadas en este ciclo, no se reenvían; se fuerza respuesta
        // final con un nudge.
        const previas = llamadasPrevias(mensajes);
        const todoRepetido =
          evento.tool_calls.length > 0 && loteEsDuplicado(evento.tool_calls, previas);
        if (todoRepetido && !forzarRespuestaFinal) {
          console.warn('[Agente] consultas duplicadas en el ciclo, forzando respuesta final');
          // El proveedor a veces devuelve tool_calls aun sin tools definidas
          // (imita el patrón del historial): se reintenta hasta 2 veces con
          // nudge creciente y solo al final se cae al texto de fallback.
          const nudgesCierre = [
            'Ya consultaste esos datos y los tenés en los resultados de arriba. PROHIBIDO hacer más consultas: respondé AHORA MISMO al comerciante con la información que ya tenés, en lenguaje simple.',
            'Esta es tu ÚLTIMA oportunidad. Está PROHIBIDO usar herramientas, pedir consultas o emitir JSON. Escribí ÚNICAMENTE tu respuesta final en texto simple para el comerciante, usando los datos que ya tenés.',
          ];
          const mensajesCierre: AgenteMessage[] = [...mensajes];
          let cerroConTexto = false;
          for (const nudge of nudgesCierre) {
            mensajesCierre.push({ role: 'user', content: nudge });
            let pidioTools = false;
            for await (const ev2 of llamarLLMAgenteStream(mensajesCierre, HERRAMIENTAS_AGENTE, {
              sinHerramientas: true,
              model: modelo,
            })) {
              if (ev2.type === 'chunk' && ev2.texto) {
                yield { type: 'chunk', texto: ev2.texto };
              } else if (ev2.type === 'done') {
                tokensFinales = ev2.tokens ?? tokensFinales;
                auditarTextoFinal('agente-cierre-duplicado', ev2.texto);
                yield { type: 'done', texto: ev2.texto, tokens: tokensFinales, uso };
                cerroConTexto = true;
              } else if (ev2.type === 'error') {
                yield { type: 'error', texto: ev2.texto };
                cerroConTexto = true;
              } else if (ev2.type === 'herramienta') {
                console.warn('[Agente] cierre sin herramientas pidió tools igual; reintentando cierre');
                pidioTools = true;
                break;
              }
            }
            if (cerroConTexto) break;
            if (!pidioTools) break;
          }
          if (!cerroConTexto) {
            // Último recurso: nunca dejar el stream mudo para que el desktop
            // no muestre una respuesta vacía.
            console.warn('[Agente] cierre fallido dos veces; fallback');
            auditarTextoFinal('agente-cierre-duplicado', '');
            yield {
              type: 'done',
              texto: 'Estoy teniendo problemas para procesar eso ahora mismo. Probá de nuevo en unos segundos o con una pregunta más acotada.',
              tokens: tokensFinales,
              uso,
            };
          }
        } else {
          // Guard de entidad (anti improvisación): si el usuario pidió crear
          // una entidad prohibida (combo, cliente, promoción, compra) y el
          // modelo emite un tool call de alta, NO se reenvía al desktop: se
          // fuerza una respuesta final con el camino manual. Sin esto, el
          // modelo improvisa con crear_producto y el daño llega al usuario.
          // Se escanean TODOS los mensajes de usuario del ciclo: en varios
          // turnos el intento queda en un turno anterior al de la tarjeta.
          const textoUsuarios = mensajes
            .filter((m) => m.role === 'user' && m.content.trim().length > 0)
            .map((m) => m.content)
            .join('\n');
          const desvio = desvioEntidadProhibida(evento.tool_calls, textoUsuarios);
          if (desvio) {
            console.warn(`[Agente] alta bloqueada: intento de ${desvio.entidad} vía ${desvio.tool}; respuesta manual`);
            mensajes.push({
              role: 'user',
              content:
                `BLOQUEO DEL SISTEMA: intentaste invocar "${desvio.tool}" cuando el comerciante pidió un/a ${desvio.entidad}. Eso está PROHIBIDO: no existe tarjeta para ${desvio.entidad} y JAMÁS uses otra tarjeta en su lugar. Respondé AHORA en texto plano explicando que se hace en ${desvio.camino}, guiándolo paso a paso. PROHIBIDO emitir herramientas o JSON.`,
            });
            let cerroBloqueo = false;
            for await (const ev3 of llamarLLMAgenteStream(mensajes, HERRAMIENTAS_AGENTE, {
              sinHerramientas: true,
              model: modelo,
            })) {
              if (ev3.type === 'chunk' && ev3.texto) {
                yield { type: 'chunk', texto: ev3.texto };
              } else if (ev3.type === 'done') {
                tokensFinales = ev3.tokens ?? tokensFinales;
                auditarTextoFinal('agente-bloqueo-entidad', ev3.texto);
                yield { type: 'done', texto: ev3.texto, tokens: tokensFinales, uso };
                cerroBloqueo = true;
              } else if (ev3.type === 'error') {
                yield { type: 'error', texto: ev3.texto };
                cerroBloqueo = true;
              } else if (ev3.type === 'herramienta') {
                // Insiste en emitir tools: no se reenvían, se cae al texto
                // determinista para no dejar el stream mudo.
                break;
              }
            }
            if (!cerroBloqueo) {
              console.warn('[Agente] bloqueo de entidad sin texto; camino manual directo');
              auditarTextoFinal('agente-bloqueo-entidad', '');
              yield {
                type: 'done',
                texto: `Eso se hace en ${desvio.camino}: elegí los datos ahí y confirmalo en la pantalla. Si querés, te ayudo con los datos (precios, stock) antes de que lo cargues.`,
                tokens: tokensFinales,
                uso,
              };
            }
          } else {
            // Se reenvían tal cual: el desktop valida el SQL y ejecuta localmente.
            // Si el desktop rechaza un tool call, devuelve el error como resultado
            // role:"tool" y el loop continúa para que el LLM se autocorrija.
            yield { type: 'herramienta', tool_calls: evento.tool_calls, uso };
          }
        }
      } else if (evento.type === 'done') {
        tokensFinales = evento.tokens ?? tokensFinales;
        let textoFinal = evento.texto;
        // Si el turno derivó el cierre a un reintento interno (memoria), el
        // done final ya se emitió ahí o el turno sigue vía tool: no duplicar.
        let omitirDoneFinal = false;
        // Guard de entidad sobre fences: el modelo a veces pega la tarjeta
        // como bloque Markdown en vez de invocar la tool nativa — o inventa
        // el bloque (crear_combo) — con el mismo daño. Si el usuario pidió
        // una entidad prohibida y el texto trae fences problemáticos (alta o
        // inventados; chart/whatsapp se respetan), se reintenta con nudge
        // específico y si persiste se quitan los fences por código.
        const textoUsuariosDone = mensajes
          .filter((m) => m.role === 'user' && m.content.trim().length > 0)
          .map((m) => m.content)
          .join('\n');
        const entidadFence = intentoEntidadProhibida(textoUsuariosDone);
        const fencesMal = entidadFence ? fencesEntidadBloqueada(textoFinal) : [];
        if (entidadFence && fencesMal.length > 0) {
          console.warn(
            `[Binny-guardian] fence bloqueado para entidad prohibida (${entidadFence}: ${fencesMal.join(',')}), reintentando`,
          );
          try {
            const base: ChatMessage[] = mensajes
              .filter((m) => m.role === 'system' || m.role === 'user' || (m.role === 'assistant' && !m.tool_calls))
              .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));
            const camino = CAMINO_ENTIDAD_PROHIBIDA[entidadFence] ?? 'la pantalla correspondiente del sistema';
            const retry = await reintentarEntidadBloqueada(base, textoFinal, entidadFence, camino, modelo);
            if (retry) {
              textoFinal = retry.texto;
              tokensFinales.prompt_tokens += retry.tokens.prompt_tokens;
              tokensFinales.completion_tokens += retry.tokens.completion_tokens;
              tokensFinales.total_tokens += retry.tokens.total_tokens;
              tokensFinales.cached_tokens += retry.tokens.cached_tokens;
            } else {
              console.warn('[Binny-guardian] fence bloqueado persistente; quitando por código');
              textoFinal = quitarFencesBloqueados(textoFinal, entidadFence, fencesMal);
            }
          } catch (e) {
            console.warn('[Binny-guardian] falló el reintento de entidad:', e);
            textoFinal = quitarFencesBloqueados(textoFinal, entidadFence, fencesMal);
          }
        }
        // Memoria automática (Ítem 1): si el usuario contó un dato estable y
        // en este turno NO se invocó guardar_memoria, un "Lo anoté" del texto
        // sería una promesa vacía. Se pide UNA vez más con tools habilitadas;
        // lo que emita se reenvía tal cual (el desktop ejecuta directo con
        // automatico o muestra tarjeta). Si insiste sin invocar, se acepta.
        const hayToolMemoria = mensajes.some((m) =>
          (m.tool_calls ?? []).some((tc: any) => tc?.function?.name === 'guardar_memoria'),
        );
        if (!hayToolMemoria && !omitirDoneFinal && intentoMemoria(textoUsuariosDone)) {
          console.warn('[Binny-memoria] dato estable sin guardar; pidiendo tool una vez');
          mensajes.push({
            role: 'user',
            content:
              'Guardá ese dato AHORA con un function call a la herramienta guardar_memoria (contenido y categoria; automatico:true porque surgió de pasada). PROHIBIDO escribir bloques de código: usá el function call, no pegues ningún ```guardar_memoria. Después de invocarla, confirmalo en texto con una frase corta.',
          });
          // tool_choice nominal: el proveedor debe devolver guardar_memoria.
          for await (const evM of llamarLLMAgenteStream(mensajes, HERRAMIENTAS_AGENTE, { model: modelo, forzarHerramienta: 'guardar_memoria' })) {
            if (evM.type === 'chunk' && evM.texto) {
              yield { type: 'chunk', texto: evM.texto };
            } else if (evM.type === 'herramienta') {
              // Se reenvía: el desktop la ejecuta directo (automatico) o con tarjeta.
              yield { type: 'herramienta', tool_calls: evM.tool_calls, uso };
              omitirDoneFinal = true;
            } else if (evM.type === 'done') {
              if (!omitirDoneFinal) {
                tokensFinales = evM.tokens ?? tokensFinales;
                textoFinal = evM.texto;
                yield { type: 'done', texto: textoFinal, tokens: tokensFinales, uso };
                omitirDoneFinal = true;
              }
            } else if (evM.type === 'error') {
              // Reintento suplementario: ante un fallo, degradar al texto
              // original en vez de mostrar un error al comerciante.
              break;
            }
          }
        }
        if (!omitirDoneFinal && (prometeSinTarjeta(textoFinal) || jsonSueltoEntidad(textoFinal))) {
          console.warn('[Binny-guardian] promesa sin tarjeta o JSON suelto en agente, reintentando una vez');
          try {
            // Solo mensajes de texto: los tool_calls sin tools confundirían al reintento.
            const base: ChatMessage[] = mensajes
              .filter((m) => m.role === 'system' || m.role === 'user' || (m.role === 'assistant' && !m.tool_calls))
              .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content }));
            const retry = await reintentarTarjetaFaltante(base, textoFinal, modelo);
            if (retry) {
              textoFinal = retry.texto;
              tokensFinales.prompt_tokens += retry.tokens.prompt_tokens;
              tokensFinales.completion_tokens += retry.tokens.completion_tokens;
              tokensFinales.total_tokens += retry.tokens.total_tokens;
              tokensFinales.cached_tokens += retry.tokens.cached_tokens;
            } else {
              console.warn('[Binny-auditoria] promesa sin tarjeta persistente en agente');
              const saneado = aplicarFallbackManual(textoFinal);
              if (saneado !== textoFinal) {
                console.warn('[Binny-guardian] fallback manual aplicado en agente');
                textoFinal = saneado;
              }
            }
          } catch (e) {
            console.warn('[Binny-guardian] falló el reintento:', e);
          }
        }
        if (!omitirDoneFinal) {
          auditarTextoFinal('agente', textoFinal);
          yield { type: 'done', texto: textoFinal, tokens: tokensFinales, uso };
        }
      } else if (evento.type === 'error') {
        yield { type: 'error', texto: evento.texto };
      }
    }

    if (tokensFinales.total_tokens > 0) {
      await acumularTokens(licenciaId, tokensFinales);
    }
  }

  // --- Binny Proactivo: Brief Diario e Informe Semanal (Fase 3) ---
  // Ninguno consume cuota (diferencial comercial); solo acumulan tokens.

  async brief(data: BriefDTO): Promise<{ texto: string; tokens: TokensProactivo; uso: UsoChat }> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
    const uso = await obtenerUso(lic.id);

    const mensajes: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: construirPromptSistema('brief', data.contexto) },
      {
        role: 'user',
        content: `Datos agregados de tu negocio hoy:\n${data.resumen}\n\nGenerá el brief del día.`,
      },
    ];

    const { respuesta, tokens } = await llamarLLM(mensajes, { jsonMode: false });
    if (tokens.total_tokens > 0) {
      await acumularTokens(lic.id, tokens);
    }

    const textoFinal = respuesta.tipo === 'respuesta' ? respuesta.texto : '';
    auditarTextoFinal('brief', textoFinal);
    return {
      texto: textoFinal,
      tokens,
      uso,
    };
  }

  async informe(data: InformeDTO): Promise<{ texto: string; tokens: TokensProactivo; uso: UsoChat }> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
    const uso = await obtenerUso(lic.id);

    const periodo = data.periodo ? ` (período: ${data.periodo})` : '';
    const mensajes: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: construirPromptSistema('informe', data.contexto) },
      {
        role: 'user',
        content: `Datos agregados de la semana${periodo}:\n${data.datos}\n\nRedactá el informe ejecutivo semanal.`,
      },
    ];

    const { respuesta, tokens } = await llamarLLM(mensajes, { jsonMode: false });
    if (tokens.total_tokens > 0) {
      await acumularTokens(lic.id, tokens);
    }

    const textoFinal = respuesta.tipo === 'respuesta' ? respuesta.texto : '';
    auditarTextoFinal('informe', textoFinal);
    return {
      texto: textoFinal,
      tokens,
      uso,
    };
  }
}

export interface TokensProactivo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
}

export interface EventoAgenteServicio {
  type: 'chunk' | 'herramienta' | 'done' | 'error';
  texto?: string;
  tool_calls?: AgenteToolCall[];
  tokens?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens: number };
  uso?: UsoChat;
}

/** Herramientas que el LLM puede invocar en modo agente. */
export const HERRAMIENTAS_AGENTE: AgenteToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'ejecutar_consulta',
      description:
        'Ejecuta una consulta SQL de SOLO LECTURA contra la información del negocio y devuelve las filas. Usala para obtener datos reales antes de responder. Podés llamarla varias veces si necesitás más datos.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description:
              'Consulta SELECT o WITH. Una sola sentencia, siempre con LIMIT (máximo 500). Fechas como timestamps Unix INTEGER.',
          },
          descripcion: {
            type: 'string',
            description:
              'Frase corta y cálida que verá el comerciante mientras se ejecuta. Ejemplo: "Buscando tus ventas de hoy...". Sin términos técnicos.',
          },
        },
        required: ['sql', 'descripcion'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_producto',
      description:
        'Muestra al comerciante una tarjeta interactiva para dar de alta un producto, con los datos ya cargados para confirmar en 1 clic. Usala SOLO cuando tengas los datos esenciales (nombre; costo/venta; stock). JAMÁS para proveedores, clientes u otra cosa. NUNCA la uses para un combo, cliente, promoción o compra: esas entidades NO tienen tarjeta y se gestionan desde sus propias pantallas (ej: un combo se arma en Combos > Nuevo Combo).',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          codigo_interno: { type: 'string' },
          codigo_barras: { type: 'string' },
          precio_costo: { type: 'number' },
          precio_venta: { type: 'number' },
          cantidad: { type: 'number', description: 'Stock inicial en unidades.' },
          stock_minimo: { type: 'number' },
          unidad_id: { type: 'number', description: 'Por defecto 1 (Unidades).' },
          marca_id: { type: 'number' },
          categoria_ids: { type: 'array', items: { type: 'number' } },
          permitir_sin_stock: { type: 'boolean' },
          alicuota_iva_id: { type: 'number' },
          presentaciones: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nombre: { type: 'string' },
                factor_conversion: { type: 'number' },
              },
              required: ['nombre', 'factor_conversion'],
            },
          },
        },
        required: ['nombre'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_proveedor',
      description:
        'Muestra al comerciante una tarjeta interactiva para dar de alta un proveedor o distribuidor, con los datos ya cargados para confirmar en 1 clic. El nombre es lo único obligatorio. JAMÁS para clientes ni productos.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          telefono: { type: 'string' },
          email: { type: 'string' },
          direccion: { type: 'string' },
          nota: { type: 'string' },
        },
        required: ['nombre'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_recordatorio',
      description:
        'Muestra al comerciante una tarjeta interactiva para programar un aviso con fecha, hora y sonido, lista para confirmar en 1 clic.',
      parameters: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          descripcion: { type: 'string' },
          fecha: { type: 'string', description: 'Formato YYYY-MM-DD.' },
          hora: { type: 'string', description: 'Formato HH:mm (24h).' },
          sonido: { type: 'string', description: 'sound_01 a sound_05, o ninguno.' },
        },
        required: ['titulo', 'fecha', 'hora'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_gasto',
      description:
        'Muestra al comerciante una tarjeta interactiva para registrar un gasto (inmediato o programado), con los datos ya cargados para confirmar en 1 clic.',
      parameters: {
        type: 'object',
        properties: {
          concepto: { type: 'string' },
          monto: { type: 'number' },
          categoria_nombre: { type: 'string' },
          metodo_pago: { type: 'string', description: 'efectivo, transferencia, debito, credito, cheque u otro.' },
          comprobante: { type: 'string' },
          nota: { type: 'string' },
          es_programado: { type: 'boolean' },
          tipo: { type: 'string', description: 'unica_vez o recurrente (solo si es programado).' },
          frecuencia: { type: 'string', description: 'diario, semanal, quincenal, mensual o anual.' },
          auto_generar: { type: 'boolean', description: 'true si es monto fijo automático.' },
        },
        required: ['concepto', 'monto'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cambiar_modulo',
      description:
        'Muestra al comerciante una tarjeta para activar o desactivar módulos del sistema de inmediato. Usala SOLO cuando lo pida explícitamente.',
      parameters: {
        type: 'object',
        properties: {
          cambios: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                modulo: { type: 'string', description: 'Clave del módulo, ej: usar_gastos.' },
                activo: { type: 'boolean' },
                nombre: { type: 'string' },
                descripcion: { type: 'string' },
              },
              required: ['modulo', 'activo'],
            },
          },
        },
        required: ['cambios'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'guardar_memoria',
      description:
        'Guarda un dato estable del negocio (proveedor habitual, rubro, preferencia, horario) para recordarlo en futuras charlas. Si el dato surgió de pasada en la conversación (nadie pidió guardarlo), poné automatico:true: se guarda directo sin tarjeta y avisale con una frase corta ("Lo anoté"). Si el comerciante pidió explícitamente recordar algo, poné automatico:false: se muestra tarjeta para confirmar.',
      parameters: {
        type: 'object',
        properties: {
          contenido: { type: 'string' },
          categoria: { type: 'string', description: 'proveedores, preferencias, rubro, clientes u otro.' },
          automatico: { type: 'boolean', description: 'true = guardar directo sin tarjeta (dato de pasada); false = tarjeta para confirmar (pedido explícito).' },
        },
        required: ['contenido'],
        additionalProperties: false,
      },
    },
    },
    {
      type: 'function',
      function: {
        name: 'simular_escenario',
        description:
          'Simula QUÉ PASARÍA si cambia un precio o un costo: calcula con ventas reales de 45 días cuánto cambiaría la facturación (tipo precio) o el margen (tipo costo). Usala SIEMPRE ante preguntas "¿qué pasa si...?", "¿cuánto más facturaría si...?", "¿qué me conviene aumentar?". JAMÁS calcules vos con aritmética mental ni con SQL: invocá la herramienta y narrá su resultado en español simple, mencionando el supuesto de volumen constante.',
        parameters: {
          type: 'object',
          properties: {
            producto_nombre: { type: 'string', description: 'Fragmento del nombre (ej: "gaseosa", "Coca"). Opcional.' },
            categoria: { type: 'string', description: 'Nombre de categoría (ej: "Bebidas"). Opcional.' },
            marca: { type: 'string', description: 'Nombre de marca. Opcional.' },
            porcentaje: { type: 'number', description: 'Cambio porcentual: 10 = subir 10%, -5 = bajar 5%. Entre -90 y 300.' },
            tipo: { type: 'string', description: '"precio" (cambia venta, mide facturación) o "costo" (cambia costo, mide margen). Por defecto precio.' },
          },
          required: ['porcentaje'],
          additionalProperties: false,
        },
      },
    },
];

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

// ============================================================================
// FASE 4: Ingesta Móvil sin Cables vía Código QR (Sesiones Efímeras y Web UI)
// ============================================================================

export interface SesionMovilFactura {
  sessionId: string;
  creadaEn: number;
  expiraEn: number;
  estado: 'esperando' | 'completada' | 'expirada';
  imagenBase64?: string;
  mimeType?: string;
  nombreArchivo?: string;
}

const sesionesMovil = new Map<string, SesionMovilFactura>();

// Limpiar sesiones expiradas periódicamente cada 5 minutos
setInterval(() => {
  const ahora = Date.now();
  for (const [id, s] of sesionesMovil.entries()) {
    if (ahora > s.expiraEn) {
      sesionesMovil.delete(id);
    }
  }
}, 5 * 60 * 1000);

export function crearSesionMovil(): { sessionId: string; expiraEn: number } {
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

export function obtenerEstadoSesionMovil(sessionId: string): {
  estado: 'esperando' | 'completada' | 'expirada' | 'no_encontrada';
  imagenBase64?: string;
  mimeType?: string;
  nombreArchivo?: string;
} {
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

export function subirImagenSesionMovil(
  sessionId: string,
  imagenBase64: string,
  mimeType?: string,
  nombreArchivo?: string,
): boolean {
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

export function renderHtmlMovil(sessionId: string): string {
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

