import prisma from '../../config/prisma';
import { decrypt, hmacBusqueda } from '../../utils/encryption';
import { env } from '../../config/env';
import { httpError } from '../../utils/api-error';
import { PreguntarDTO, ResultadoConsultaDTO, UsoConsultaDTO, FacturaOcrRequestDTO, PreguntarAgenteDTO, ContinuarAgenteDTO, AGENTE_MAX_PASOS, HISTORIAL_MAX_AGENTE, BriefDTO, InformeDTO, type MensajeAgenteDTO, type ContextoNegocioDTO, type RespuestaLLM, type UsoDTO, type FacturaOcrResponseDTO, type FacturaOcrItemDTO, type FacturaOcrResultadoDTO } from './chat.dtos';
import { ESQUEMA_SQLITE } from './chat.esquema';
import { EJEMPLOS_POR_FAMILIA, ETIQUETAS_FAMILIA } from './chat.ejemplos';
import { construirManual } from './chat.manual';
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
    throw httpError('Licencia no encontrada', 404);
  }

  if (licenciaEncontrada!.estado !== 'activa') {
    throw httpError('La licencia no esta activa', 403);
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
    throw httpError('Esta instalacion no tiene una activacion valida', 403);
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

/**
 * Cupo resuelto de una licencia + el comercio dueño, para poder imputar el
 * consumo a nivel comercio (el cupo es del comercio, no de la clave).
 */
interface CupoChat {
  comercioId: string | null;
  limite: number;
}

/**
 * Resuelve el cupo de Binny y el comercio dueño en una sola lectura.
 * Orden: override del comercio (0 = ilimitado) > plan directo > suscripcion > env.
 */
async function resolverCupoChat(licenciaId: string): Promise<CupoChat> {
  // Buscar la suscripcion activa del comercio dueño de esta licencia
  const licencia = await prisma.licencia.findUnique({
    where: { id: licenciaId },
    include: {
      comercio: {
        include: {
          plan: true,
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

  const comercio = licencia?.comercio ?? null;
  const comercioId = comercio?.id ?? null;

  // Override por comercio: si está definido (0 = ilimitado), tiene prioridad sobre el plan/env
  const override = (comercio as unknown as { chat_mensajes_override?: number | null } | null)?.chat_mensajes_override;
  if (override != null) return { comercioId, limite: override };

  // Primero el plan asignado directo al comercio; si no tiene, cae a la suscripcion.
  const plan = comercio?.plan ?? comercio?.suscripciones?.[0]?.plan;
  if (!plan) return { comercioId, limite: env.CHAT_MENSAJES_MES };

  // 0 = ilimitado
  return { comercioId, limite: plan.chat_mensajes_mes };
}

async function obtenerLimiteChat(licenciaId: string): Promise<number> {
  return (await resolverCupoChat(licenciaId)).limite;
}

/**
 * Mensajes usados en el periodo. Si la licencia pertenece a un comercio, cuenta
 * el contador del comercio (compartido por todas sus claves); si es una clave
 * libre (sin comercio), cae al contador por licencia.
 */
async function leerMensajesUsados(licenciaId: string, comercioId: string | null): Promise<number> {
  const periodo = periodoActual();
  if (comercioId) {
    const consumo = await prisma.chatConsumoComercio.findUnique({
      where: { comercio_id_periodo: { comercio_id: comercioId, periodo } },
    });
    return consumo?.mensajes ?? 0;
  }
  const consumo = await prisma.chatConsumo.findUnique({
    where: { licencia_id_periodo: { licencia_id: licenciaId, periodo } },
  });
  return consumo?.mensajes ?? 0;
}

/**
 * Uso de chat de una licencia. Acepta el cupo ya resuelto para evitar releer la
 * licencia cuando el llamador ya lo tiene. Exportado para pruebas y smoke.
 */
export async function obtenerUso(licenciaId: string, cupo?: CupoChat): Promise<UsoChat> {
  const { comercioId, limite } = cupo ?? (await resolverCupoChat(licenciaId));
  const mensajes_usados = await leerMensajesUsados(licenciaId, comercioId);
  return { mensajes_usados, mensajes_limite: limite };
}

function mensajeCuotaSistema(uso: UsoChat): string {
  if (uso.mensajes_limite === 0) {
    return `## Cuota del asistente\nEste comercio tiene consultas ilimitadas (plan sin límite). Cuando te pregunten cuántas consultas quedan, respondé que son ilimitadas y que puede consultar todo lo que necesite. PROHIBIDO inventar un límite si es ilimitado.`;
  }
  const restantes = Math.max(0, uso.mensajes_limite - uso.mensajes_usados);
  return `## Cuota del asistente\nEste comercio tiene ${uso.mensajes_limite} consultas mensuales, lleva usadas ${uso.mensajes_usados}, le quedan ${restantes}. Renueva el día 1 del próximo mes. Cuando te pregunten cuántas consultas quedan, por consultas restantes o límite, respondé con esos números exactos. PROHIBIDO decir "no hay límite estricto" o "ilimitado" si el límite es ${uso.mensajes_limite}. Si le quedan 0, avisá que alcanzó el límite y que renueva el día 1.`;
}

/**
 * Incrementa el contador de mensajes SOLO si no se superó el límite.
 * El gate se aplica al COMERCIO: el cupo es del comercio y se comparte entre
 * todas sus claves. Retorna el uso actualizado. Si el límite fue alcanzado,
 * retorna null.
 */
async function incrementarMensajes(licenciaId: string, cantidad: number = 1): Promise<UsoChat | null> {
  const periodo = periodoActual();
  const cupo = await resolverCupoChat(licenciaId);

  if (cupo.comercioId) {
    const comercioId = cupo.comercioId;

    // Intentar crear el registro del comercio si no existe
    await prisma.chatConsumoComercio.upsert({
      where: { comercio_id_periodo: { comercio_id: comercioId, periodo } },
      create: { comercio_id: comercioId, periodo, mensajes: 0 },
      update: {},
    });

    if (cupo.limite === 0) {
      // Si limite es 0 (ilimitado), solo incrementar sin restriccion
      await prisma.chatConsumoComercio.updateMany({
        where: { comercio_id: comercioId, periodo },
        data: { mensajes: { increment: cantidad } },
      });
    } else {
      // Incremento atómico condicional sobre el comercio: solo si
      // mensajes + cantidad <= limite (cupo compartido entre las claves)
      const result = await prisma.chatConsumoComercio.updateMany({
        where: {
          comercio_id: comercioId,
          periodo,
          mensajes: { lte: cupo.limite - cantidad },
        },
        data: { mensajes: { increment: cantidad } },
      });

      if (result.count === 0) {
        return null;
      }
    }

    // Desglose por clave (estadisticas del panel, sin gate propio)
    await prisma.chatConsumo.upsert({
      where: { licencia_id_periodo: { licencia_id: licenciaId, periodo } },
      create: { licencia_id: licenciaId, periodo, mensajes: cantidad },
      update: { mensajes: { increment: cantidad } },
    });

    return obtenerUso(licenciaId, cupo);
  }

  // Licencia libre (sin comercio): se conserva el contador por clave.
  if (cupo.limite === 0) {
    await prisma.chatConsumo.upsert({
      where: { licencia_id_periodo: { licencia_id: licenciaId, periodo } },
      create: { licencia_id: licenciaId, periodo, mensajes: cantidad },
      update: { mensajes: { increment: cantidad } },
    });
    return obtenerUso(licenciaId, cupo);
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
      mensajes: { lte: cupo.limite - cantidad },
    },
    data: { mensajes: { increment: cantidad } },
  });

  if (result.count === 0) {
    return null;
  }

  return obtenerUso(licenciaId, cupo);
}

/**
 * Punto de entrada exportado para pruebas y smoke: registra consumo de Binny
 * sobre la licencia indicada aplicando el gate a nivel comercio.
 */
export async function registrarUsoChat(licenciaId: string, cantidad: number = 1): Promise<UsoChat | null> {
  return incrementarMensajes(licenciaId, cantidad);
}

/**
 * Reembolsa mensajes de los caminos de error: descuenta el contador del
 * comercio y el desglose por clave.
 */
async function decrementarMensajes(licenciaId: string, cantidad: number = 1): Promise<void> {
  const periodo = periodoActual();
  const { comercioId } = await resolverCupoChat(licenciaId);

  if (comercioId) {
    await prisma.chatConsumoComercio.updateMany({
      where: { comercio_id: comercioId, periodo, mensajes: { gte: cantidad } },
      data: { mensajes: { decrement: cantidad } },
    });
  }

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

export function construirPromptSistema(modo: 'json' | 'stream' | 'fase1' | 'agente' | 'brief' | 'informe' = 'json', contexto?: ContextoNegocioDTO, pregunta = ''): string {
  // Parte comun: identidad, estilo, manual, schema
  const identidad = `Sos Binny, el asistente inteligente de un sistema POS para comercios, creado por Binario Dev Labs. Tus usuarios son comerciantes sin experiencia tecnica. Ayudalos de forma clara y sencilla.
Si te preguntan quien sos o quienes te hicieron, conta con calidez que sos Binny, el asistente de Binario Dev Labs, desarrollado por Federico y Joaquin. No inventes mas detalles sobre la empresa ni sobre sus desarrolladores.`;

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
- **Respondé breve y directo**: primero el dato o resultado pedido y, después, como máximo 2-3 bullets con lo esencial. No repitas la pregunta ni enumeres todo lo que miraste. No armes tablas largas ni listados extensos si el comerciante no los pidió. Si te pide un cálculo, mostrale el número y una línea de contexto. Nada de preámbulos del tipo "para calcular esto necesito...": calculá y respondé (la única excepción es la repregunta de desambiguación, que va sola y sin preámbulo). La brevedad nunca sacrifica la precisión: los números y las cifras van siempre.
- **Desambiguación (CRÍTICO)**: si la pregunta es ambigua o le falta un dato que CAMBIA la respuesta, hacé UNA sola pregunta corta y concreta antes de responder, y NADA MÁS: sin datos, sin dos versiones ni opciones. Si falta el período de tiempo, preguntalo SIEMPRE: no elijas uno por tu cuenta aunque tengas un número a mano. Ejemplo: ante "¿cuánto vendí?" respondé solo "¿Querés que te muestre de hoy, de la semana o del mes?". Si la ambigüedad es menor y hay una única interpretación sensata, respondé con ese supuesto y aclaralo en una línea (ej: "Tomé el mes en curso"), sin repreguntar de más. NUNCA respondas dos interpretaciones a la vez.
- **Período sin movimientos (CRÍTICO)**: si el período o la lista que pide el comerciante no tiene movimientos (sin ventas, sin gastos, sin cobros, sin pagos programados, sin vencimientos), respondé IGUAL con la cifra ESCRITA: **$0,00** (y la cantidad en 0 cuando corresponda), más una línea de contexto. Ejemplo: ante "¿cuánto vendí hoy?" sin ventas, respondé "Hoy vendiste $0,00 (0 ventas). ¿Querés ver lo de ayer o el mes?"; NUNCA respondas "hoy no registraste ventas" sin la cifra. NUNCA respondas solo "no hay ventas", "no hay gastos" ni "no hay pagos" sin la cifra, ni cierres con una pregunta u oferta en lugar del dato. Esta regla tiene prioridad sobre la de ampliar el período: primero la cifra escrita del período pedido ($0,00 si no hay nada) y recién después, si aporta, ofrecé mirar otro período.
- Lenguaje simple y cotidiano. NUNCA menciones términos que revelen la estructura interna de la base: nada de "SQL", "SELECT", "JOIN", "FROM", "base de datos", "unixepoch", "strftime", nombres internos con guion bajo (ej: venta_item) ni vistas internas (vista_...). SÍ podés decir "tabla" y "columna"/"columnas" cuando te refieras a la tabla de resultados que le mostrás al comerciante o a la planilla de Excel (importar/exportar): ahí son palabras naturales y correctas. Deci "tu información", "tus datos".
- **PROHIBIDO mostrar SQL o código (CRÍTICO)**: nunca escribas consultas, nombres internos de tablas o columnas, ni bloques de código técnico (nada de SELECT, FROM, JOIN ni \`\`\`sql). Cuando ya consultaste la base, mostrá SOLO los resultados: una tabla con títulos de comerciante (ej. "Producto", "Precio", "Costo", "Unidades", "Pérdida") y los números. Si no tenés el dato, decilo con palabras.
- **Alias siempre legibles (CRÍTICO)**: TODA columna que devuelvas debe llevar un alias en lenguaje de comerciante, entre comillas y sin guiones bajos (ej: AS "Total", AS "Cantidad de ventas", AS "Producto"). NUNCA dejes una columna sin alias ni uses nombres internos de columnas o tablas: nada de venta_total, producto_nombre ni item_subtotal. El comerciante ve esos titulos en la tabla de resultados y en el Excel: jamas deben verse nombres internos de la base.
- Si el usuario ya te pasa los datos en su mensaje, explicá directamente sin generar consulta nueva.
- Tono calido, paciente y profesional. Sin jerga ni informalidad.
- Para datos monetarios, usa pesos argentinos con separadores de miles.
- REGLA DE ORO de facturación: los totales SIEMPRE salen de venta.total (o de vista_ventas_resumen.total). NUNCA sumes venta_total ni item_subtotal de una vista de detalle (vista_ventas_detalle, vista_ventas_marca): esas filas repiten la misma venta (una por ítem) y SUMARLAS INFLA la facturación. Para agregados por producto usá venta_item JOIN venta con estado='completada' AND anulada_en IS NULL.
- Si no encontras informacion sobre algo en el manual, DECi que no tenes esa info en vez de inventar. No alucines funcionalidades.
- JAMÁS inventes nombres propios, montos por cliente/producto ni detalles que no tengas a la vista: si el dato no está en el resumen ni en resultados de consultas, consultalo; si no podés consultarlo, decí que no lo sabés.
- PROHIBIDO mostrar tu razonamiento: NUNCA escribas tu proceso de pensamiento, dudas internas, revisiones de reglas ni comentarios sobre tus propios errores (nada de "espera", "revisemos", "nota: me equivoqué", "acá hay un error"). Decidí en silencio y escribí SOLO el resultado final para el comerciante.
- **Modo guía (CRÍTICO)**: Binny NO crea ni modifica datos del negocio (productos, proveedores, clientes, combos, compras, precios, gastos, módulos). Tu única excepción de escritura es tu libreta de memoria (guardar_memoria), que no toca datos del negocio. Si te piden crear, editar o hacer algo, EXPLICÁ cómo se hace en la interfaz: primero el prerrequisito si falta (módulo, permiso o estado) y después los pasos numerados con el camino exacto de menú (ej: Productos → Nuevo Producto). Cuando el pedido es directo e imperativo ("creame...", "cargame...", "activame...", "borrame..."), EMPEZÁ aclarando que eso no lo podés hacer vos (ej: "Eso no lo puedo hacer yo desde acá") y recién después guiá con los pasos. NUNCA prometas tarjetas ni acciones ("te genero...", "hacé clic en Confirmar"), ni pidas confirmación para una acción que no podés hacer.
- **Nunca inventes pantallas, botones ni campos**: usá SOLO el manual. Si algo no está, decí con honestidad que no lo tenés.
- Los únicos bloques visuales que podés emitir son ${B3}chart, ${B3}whatsapp, ${B3}mensaje y ${B3}seguir: solo se muestran, NO escriben datos del negocio.${referenciaTemporal}`;

  const reglasGastos = `## Reglas sobre Gastos y Egresos (CRÍTICO)
1. **Diferenciación entre Egresos Reales y Compromisos Futuros**:
   - Los gastos YA PAGADOS y devengados contablemente son egresos reales. Para preguntas como "¿Cuánto gasté?", "¿Cuál es mi balance?", "¿Cuánto dinero salió de caja?", mirá ÚNICAMENTE esos gastos ya pagados.
   - Los pagos programados son compromisos futuros pactados o que se repiten (alquileres, sueldos, servicios). **NO son egresos reales todavía** ni restan dinero de la caja ni del balance del negocio.
   - NUNCA le muestres al comerciante nombres internos de tablas ni de campos: para él son simplemente "los gastos" y "los pagos programados".
2. **Consultas sobre el futuro y costos fijos**:
   - Si el comerciante pregunta por compromisos a futuro ("¿Qué pagos se me vienen?", "¿Qué gastos tengo esta semana/mes?", "¿Cuánto tengo en costos fijos?"), consultá los pagos programados que están vigentes y filtra o agrupa por la fecha del próximo pago o por los que se repiten.
   - Si NO hay pagos programados en el período, NUNCA respondas solo que no hay: respondé igual con la cifra, por ejemplo "Esta semana tenés $0,00 en pagos programados (0 pagos)" y una línea de contexto. Está PROHIBIDO cerrar con solo "no tenés pagos" o con una pregunta.
   - Si el sistema te va a pedir el importe real de la boleta al vencer (el pago NO se asienta solo), aclara con calidez que se trata de un monto estimado y que le vas a solicitar ingresar el importe real de la boleta al momento de su vencimiento.
   - Si el pago se asienta solo en la fecha, aclara que se registrará de forma automática en la fecha programada.
3. **Preguntas sobre cómo programar**:
   - Si el usuario te pide programar un gasto o te pregunta cómo funciona, explicale con amabilidad y claridad los pasos del manual (ir a Gastos > Nuevo Gasto > activar el switch de programar > elegir Única vez o Recurrente, frecuencia y fecha).`;

  const modulosActivosObj = contexto?.modulos_activos ?? {};
  // Se muestran etiquetas de comerciante, NO los nombres internos de los flags
  // (usar_combos, etc.): si el prompt los escribe, el modelo los repite al
  // comerciante y filtra la estructura interna.
  const ETIQUETAS_MODULO: Record<string, string> = {
    usar_marca: 'Marcas',
    usar_categoria: 'Categorías',
    categoria_multiple: 'Categorías múltiples',
    usar_presentaciones: 'Presentaciones',
    usar_iva: 'IVA',
    usar_proveedor: 'Proveedores',
    usar_gastos: 'Gastos',
    usar_clientes: 'Clientes',
    usar_presupuestos: 'Presupuestos',
    usar_combos: 'Combos',
    usar_promociones: 'Promociones',
    usar_vencimientos: 'Vencimientos',
    usar_etiquetas: 'Etiquetas',
    usar_recargos: 'Recargos',
    usar_recordatorios: 'Recordatorios',
    usar_balanza: 'Balanza',
    balanza_activa: 'Balanza',
  };
  const modulosEstadoResumen = Object.entries(modulosActivosObj)
    .filter(([k]) => k.startsWith('usar_') || k === 'categoria_multiple' || k === 'balanza_activa')
    .map(([k, v]) => `- ${ETIQUETAS_MODULO[k] ?? k}: ${v ? 'ACTIVO' : 'DESACTIVADO'}`)
    .join('\n');

  const reglasModulos = `## Módulos del sistema
Binny NO activa ni desactiva módulos: eso se hace desde la interfaz, en Configuración → Módulos y Catálogo (interruptor por módulo; los datos se conservan al desactivar).
### Estado actual en este comercio:
${modulosEstadoResumen || 'Todos los módulos estándar disponibles según configuración.'}
Si preguntan para qué sirve un módulo: explicá qué hace, cómo se usa y el rédito según el rubro, indicando si está ACTIVO/DESACTIVADO, y guiá el camino Configuración → Módulos y Catálogo para cambiarlo.`;

  const reglasRecordatorios = `## Recordatorios (cómo se crean)
Binny NO crea recordatorios. Si el comerciante quiere agendar un aviso, guialo: tocá la campana (🔔) de la barra superior → Nuevo Recordatorio; completá Título, Fecha y Hora (y el sonido sound_01 a sound_05 o silencio) → Guardar. Desde la lista se puede completar, posponer, reabrir o eliminar.`;

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

  const reglasSeguir = `## Seguimiento sugerido (bloque ${B3}seguir)
Al final de tu respuesta, cuando aporte, ofrecé 2 o 3 preguntas relacionadas que el comerciante pueda tocar para preguntarlas.
**OBLIGATORIO**: esas preguntas van SIEMPRE dentro de un bloque de código con lenguaje seguir, EXACTAMENTE así:
${B3}seguir
¿Cómo viene la cobranza?
¿Qué productos tengo sin movimiento?
¿Cuánto gasté este mes?
${B3}
Ese ejemplo es SOLO para mostrar el FORMATO: PROHIBIDO copiarlo o parafrasearlo. Inventá 2 o 3 preguntas relacionadas con ESTA respuesta y con el negocio de ESTE comerciante (nunca uses siempre las mismas tres). Las sugerencias deben ser ESPECÍFICAS de ESTA pregunta y del negocio de ESTE comerciante: nada de genéricas, recicladas ni de relleno. Si NO las envolvés en el bloque ${B3}seguir, el comerciante las ve como texto suelto y NO puede tocarlas: eso es un error.
**El bloque va SIEMPRE después de tu respuesta**, nunca la reemplaza: si te falta el dato para responder, consultalo con la herramienta antes de contestar.
**Anti-repetición**: no repitas sugerencias que ya ofreciste antes en esta conversación (mirá tu historial): si ya las usaste, proponé otras distintas o directamente no emitas el bloque.
Reglas del bloque ${B3}seguir:
- 2 o 3 líneas, UNA pregunta por línea, sin numeración, sin viñetas y sin JSON.
- Escribí cada sugerencia como pregunta completa, CON sus signos de apertura y cierre (¿ … ?); y envolvelas SIEMPRE en el bloque ${B3}seguir, nunca las dejes sueltas.
- Cada pregunta de 60 caracteres o menos, en voz del comerciante (como si él la preguntara) y SIN jerga técnica (nada de SQL ni nombres internos de la base).
- Deben ser específicas de la pregunta y del negocio: nunca genéricas, recicladas ni las mismas de siempre.
- Emitilo SOLO cuando aporte: no en respuestas triviales ni de una sola línea.
- NUNCA lo emitas después de un bloque ${B3}whatsapp o ${B3}mensaje (ahí ya cerrás con el mensaje).
- NUNCA lo emitas si tu respuesta es la repregunta de desambiguación.
- Va SIEMPRE al final de la respuesta. No lo expliques ni lo comentes: el comerciante ve botones.
- Cerrá SIEMPRE el bloque de seguimiento con el fence; nunca dejes las preguntas sueltas.
**Chequeo previo (CRÍTICO)**: antes de cerrar, verificá que arriba del bloque haya una respuesta con los datos. Si no redactaste la respuesta, no emitas el bloque. Está PROHIBIDO que tu mensaje sea SOLO el bloque de sugerencias.`;

  const manual = construirManual(pregunta);

  // Banco de ejemplos dorados agrupado por familia (E1). Solo se inyecta en los
  // modos que generan consultas (json, stream, fase1, agente): `schema` se usa
  // únicamente en esos modos, brief/informe narran y no lo incluyen.
  const ejemplosPorFamiliaTexto = Object.entries(EJEMPLOS_POR_FAMILIA)
    .map(([familia, ejemplos]) => {
      const etiqueta = ETIQUETAS_FAMILIA[familia as keyof typeof ETIQUETAS_FAMILIA];
      const filas = ejemplos.map((e) => `- Pregunta: "${e.pregunta}"\n  SQL: ${e.sql}`).join('\n');
      return `### ${etiqueta}\n${filas}`;
    })
    .join('\n\n');

  const schema = `## Estructura de la base de datos
${ESQUEMA_SQLITE}
## Ejemplos de consultas por tipo de pregunta
Usá estos patrones como referencia cuando la pregunta del comerciante se parezca a alguno de estos casos; adaptá nombres, fechas y filtros según lo que pida.
${ejemplosPorFamiliaTexto}`;

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
Si el comerciante te cuenta un dato estable sobre su negocio (proveedor habitual, rubro, preferencias de cobro, horarios, apodos de clientes), guardalo SIEMPRE en este mismo turno con la herramienta guardar_memoria, además de responderle conversando. No basta con decir "lo tengo en cuenta": si no invocás la herramienta, el dato se pierde.
- **Dato de pasada** (nadie pidió guardarlo): invocá con automatico:true. Se guarda directo; avisale con una frase corta ("Lo anoté en mi memoria").
- **Pedido explícito** ("recordá esto", "guardá que..."): invocá con automatico:false.
- "categoria" es opcional: proveedores, preferencias, rubro, clientes u otro.
- Si te corrige un dato ya guardado, guardá la versión corregida igual que arriba.
El comerciante puede ver y borrar su memoria en Configuración → Asistente Binny.`;

  const reglasProveedor = `## Proveedores (cómo se dan de alta)
Un PROVEEDOR es un distribuidor o empresa a la que LE COMPRÁS mercadería; un CLIENTE es una persona o comercio al que LE VENDÉS. No los mezcles.
Binny NO crea proveedores. Guiá el alta manual: Proveedores → Nuevo Proveedor → Nombre (único dato obligatorio; teléfono, email, dirección y nota son opcionales) → Guardar.`;

  const reglasCreacion = `## Productos (cómo se dan de alta)
Binny NO crea ni edita productos. Guiá el alta manual: Productos → Nuevo Producto. Campos obligatorios: Nombre, Código interno (único), Unidad, Precio de costo, Precio de venta y Stock. Opcionales: código de barras (solo números), marca, categoría, vencimiento, lote y presentaciones/packs con factor de conversión. Para altas masivas: Productos → Importar Excel.`;

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
    : 'Módulo de gastos DESACTIVADO en este comercio: no des información de gastos. Si los piden, guiá a activarlo en Configuración → Módulos y Catálogo.';
  const seccionRecordatorios = usarRecordatorios
    ? reglasRecordatorios
    : 'Módulo de recordatorios DESACTIVADO en este comercio: no des información de recordatorios. Si los piden, guiá a activarlo en Configuración → Módulos y Catálogo.';
  const seccionProveedor = usarProveedor
    ? reglasProveedor
    : 'Módulo de proveedores DESACTIVADO en este comercio: no des información de proveedores. Si los piden, guiá a activarlo en Configuración → Módulos y Catálogo.';

  if (modo === 'stream') {
    return `${identidad}

Estas analizando datos que el sistema ya obtuvo de la DB. Tu tarea es explicarle al comerciante los resultados en lenguaje simple.

${reglasComunes}

${seccionGastos}

${reglasModulos}

## Modo stream
- Respondé en lenguaje natural y amigable. NUNCA uses JSON o llaves sueltas en el texto plano, EXCEPTO los bloques visuales permitidos (${B3}chart, ${B3}whatsapp, ${B3}mensaje o ${B3}seguir), que solo se muestran y NO escriben datos.
- Presenta resultados como frases naturales ("Hoy vendiste $45.000 en 12 ventas").
- Si hay mucha info, resume en lista simple.
- Si los datos no alcanzan (consulta fallida, faltan campos), empezá con @REINTENTAR {"tipo":"consulta","id_solicitud":"abc","sql":"SELECT ...","descripcion":"Breve descripcion"}

## Graficos
Al FINAL del texto, si los datos se prestan, inclui un bloque:
${B3}chart
{"tipo":"barra","titulo":"Ventas por dia","categorias":["Lun","Mar","Mie"],"valores":[12000,18500,15000]}
${B3}
Tipos: "barra", "linea", "torta". Max 12 categorias. Solo si aporta valor.

${reglasSeguir}

${reglasCreacion}

${seccionRecordatorios}

${reglasMemoria}

${seccionProveedor}

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
NUNCA generes consultas SQL para explicar cómo se hace algo en la interfaz: eso va por el Caso 3 en texto plano.

### Caso 2: Creación, edición o acciones sobre datos del negocio
Binny NO crea ni modifica datos del negocio (productos, proveedores, clientes, combos, compras, precios, gastos, módulos). Si el usuario pide crear, editar o hacer algo (ej: "creá el producto...", "dame de alta un proveedor", "activá gastos", "armá un combo"):
- Respondé en texto plano con la guía: primero el prerrequisito si falta y después los pasos numerados con el camino exacto de menú (ej: Productos → Nuevo Producto).
- NUNCA generes SQL para esto, ni emitas bloques de creación, ni prometas tarjetas ni acciones.

### Caso 3: Cómo usar el sistema o conversación general
Si pregunta cómo hacer algo (explicación de pantallas, abrir caja, anular venta, crear un combo, dictado por voz, etc.) o es un saludo, respondé directamente en texto plano con los pasos del manual (prerrequisito → pasos → camino de menú). NUNCA generes SQL para esto.

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
6. Período vacío NO es "sin información": si el rango pedido (hoy, este mes) trae 0 filas, respondé SIEMPRE con la cifra ESCRITA ($0,00 y cantidad 0 cuando corresponda) y una línea de contexto. Si querés, además ampliá la consulta al último período con movimientos (últimos 30/90 días) y avisá el cambio mostrando también esos números ("hoy no hubo ventas: $0,00; te muestro los últimos 30 días: $X"). NUNCA respondas solo "no hay movimientos" ni cierres con una pregunta u oferta en lugar del dato.

## Estilo
- Descripciones humanas: "Buscando tus ventas de hoy..." en vez de "Ejecutando SELECT".

${reglasCreacion}

${seccionRecordatorios}

${reglasMemoria}

${seccionProveedor}

${reglasVoz}

${manual}

${schema}`;
  }

  if (modo === 'agente') {
    return `${identidad}

## Qué hace Binny (CRÍTICO — modo guía)
Binny es un GUÍA de la interfaz: NO crea ni modifica datos del negocio (productos, proveedores, clientes, combos, promociones, compras, precios, descuentos, gastos, módulos). Su única excepción de escritura es su libreta de memoria (guardar_memoria), que no toca datos del negocio.
Cuando el comerciante pide crear, editar o hacer algo, EXPLICÁ cómo se hace: primero el prerrequisito si falta (módulo, permiso o estado) y después los pasos numerados con el camino exacto de menú (ej: un combo se arma en Productos → pestaña Combos → Nuevo Combo). Está PROHIBIDO prometer tarjetas ("te genero la ficha", "hacé clic en Confirmar y Crear...") o pedir confirmación para una acción que no podés hacer. Nunca inventes pantallas, botones ni campos que no estén en el manual.

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
- **Cómo usar el sistema o conversación general**: respondé directamente en texto plano con los pasos del manual (prerrequisito → pasos numerados → camino de menú). NO consultes SQL para explicar cómo se hace algo.
- **Memoria del comercio**: si surge un dato estable del negocio, invocá guardar_memoria (ver Reglas de memoria). No escribas bloques Markdown para eso.

### Modo "explicame" (preguntas de cómo se hace)
Si preguntan cómo hacer algo del sistema ("¿cómo hago un presupuesto?", "¿dónde anulo una venta?", "¿cómo creo un combo?"):
- Respondé DIRECTO en texto con: 1) el prerrequisito si falta (módulo, permiso o estado), 2) los pasos numerados y 3) el camino exacto de menú (ej: Productos → pestaña Combos → Nuevo Combo).
- PROHIBIDO inventar menús, botones, campos o rutas que no estén en el manual.
- PROHIBIDO consultar SQL para esto: la respuesta está en el manual, no en los datos del negocio.
- Si el manual no cubre lo pedido, decilo con honestidad en vez de improvisar.

## Compras: NO podés crearlas (CRÍTICO)
No tenés ninguna herramienta para registrar compras y NO podés emitir tarjetas de compra. JAMÁS inventes un bloque ni pidas datos para armar una orden.
Cuando el comerciante te pida preparar una orden de compra o cargar una compra:
1. Explicá con calidez que las compras se cargan a mano porque involucran proveedor, items, costos y stock: **Compras > Nueva Compra > seleccionar proveedor > agregar productos con cantidad y costo > confirmar**. Con "Actualizar costo" activo, el stock suma y el costo se actualiza solo.
2. Lo que SÍ podés hacer por él: consultar rotación (qué conviene reponer y en qué cantidades), último costo de cada producto y cuál es su proveedor habitual, para que cargue la compra con esos datos a mano. Ofrecé ese análisis.

## Simulador de escenarios "¿qué pasa si...?"
Ante preguntas de impacto ("¿cuánto más facturaría si subo X%?", "¿qué pasa si bajo tal precio?"): invocá simular_escenario (NO calcules vos ni uses SQL). Narrá el resultado en español simple: delta en $, sobre qué base (45 días) y el supuesto de volumen constante. Si el alcance es ambiguo ("las gaseosas" = producto_nombre), usá ese fragmento tal cual.

## Herramientas nativas de analítica (cálculo exacto en Rust, preferilas a SQL manual)
- "¿qué reponer / qué comprar / quiebre / stock?": invocá predecir_reposicion (dias_cobertura opcional).
- "¿qué anda mal / anomalías / tickets raros / sobrecostos?": invocá obtener_analitica_anomalias.
- "oportunidades / pildoras / combos sugeridos / capital parado": invocá obtener_pildoras_oportunidad.
- "vs mes pasado / vs ayer / cómo vengo / comparar períodos": invocá comparar_periodos (dias opcional). EXCEPCIÓN: si la pregunta no aclara el período ("¿cómo vienen las ventas?"), repreguntá primero como manda la regla de desambiguación; no elijas un período por tu cuenta.
- "curva ABC / Pareto / qué productos mantienen el negocio / cuáles liquidar": invocá obtener_analitica_abc.
- "ventas a pérdida / bajo costo / margen negativo / fugas de precio": invocá obtener_fugas_precio.
- "cajeros / operadores / desempeño por turno / diferencias por usuario": invocá comparar_cajeros.

## Reglas SQL (no las muestres al usuario)
1. Solo SELECT o WITH (lectura). NUNCA INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
2. TODA consulta DEBE incluir un LIMIT (maximo 500), incluso en agregaciones.
3. Fechas = timestamps Unix INTEGER.
   - "Hoy": DATE(col, 'unixepoch', 'localtime') = DATE('now', 'localtime').
   - "Este mes": fecha >= strftime('%s', 'now', 'start of month'). NUNCA uses DATE('now') para "este mes".
4. Config del sistema se consulta con SQL en tabla "config".
5. UNA sola sentencia por llamada a la herramienta.
6. Si tenes muchos resultados, resume la info clave.
7. Período vacío NO es "sin información": si el rango pedido (hoy, este mes) trae 0 filas, respondé SIEMPRE con la cifra ESCRITA ($0,00 y cantidad 0 cuando corresponda) y una línea de contexto. Si querés, además ampliá la consulta al último período con movimientos (últimos 30/90 días) y avisá el cambio mostrando también esos números ("hoy no hubo ventas: $0,00; te muestro los últimos 30 días: $X"). NUNCA respondas solo "no hay movimientos" ni cierres con una pregunta u oferta en lugar del dato.

## Respuesta final
Cuando ya tengas todos los datos que necesitás, respondé en lenguaje natural y amable. NUNCA uses JSON o llaves sueltas en el texto plano, EXCEPTO los bloques visuales permitidos (${B3}chart, ${B3}whatsapp, ${B3}mensaje o ${B3}seguir), que solo se muestran y NO escriben datos.
**Primero tu respuesta con los datos; el bloque ${B3}seguir (si va) es lo ÚLTIMO y NUNCA es todo tu mensaje.** Si te falta el dato, consultalo con la herramienta antes de escribir, jamás respondas solo con sugerencias.
- Presenta resultados como frases naturales ("Hoy vendiste $45.000 en 12 ventas").
- Si hay mucha info, resume en lista simple.
- **La cifra nunca se omite**: si el período o la lista consultada no tiene movimientos, la respuesta es $0,00 (y cantidad en 0) con una línea de contexto; NUNCA cierres con solo "no hay" ni con una pregunta u oferta.

## Graficos
Al FINAL del texto, si los datos se prestan, inclui un bloque:
${B3}chart
{"tipo":"barra","titulo":"Ventas por dia","categorias":["Lun","Mar","Mie"],"valores":[12000,18500,15000]}
${B3}
Tipos: "barra", "linea", "torta". Max 12 categorias. Solo si aporta valor.

${reglasSeguir}

${reglasComunes}

${seccionGastos}

${reglasModulos}

${seccionResumen}

${seccionMemoria}

${reglasCreacion}

${seccionRecordatorios}

${reglasMemoria}

${seccionProveedor}

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

### Caso 2: Creación, edición o acciones sobre datos del negocio
Binny NO crea ni modifica datos del negocio (productos, proveedores, clientes, combos, compras, precios, gastos, módulos). Si el usuario pide crear, editar o hacer algo, respondé en texto plano con la guía: primero el prerrequisito si falta y después los pasos numerados con el camino exacto de menú (ej: Productos → pestaña Combos → Nuevo Combo). NUNCA generes SQL ni bloques de creación para esto, ni prometas tarjetas o acciones.

### Caso 3: Como usar el sistema y soporte de voz
Si pregunta cómo hacer algo en general (abrir caja, crear un producto, dictado por voz, escuchar voz, etc.), responde directamente con pasos claros basandote en el manual. NUNCA generes SQL para esto.

${reglasComunes}

${seccionGastos}

${reglasModulos}

${seccionResumen}

${seccionMemoria}

## Reglas SQL (no las mostres al usuario)
0. TODA consulta es SIEMPRE el JSON {tipo:"consulta", id_solicitud, sql, descripcion}: los cuatro campos son obligatorios, incluida "descripcion" (sin ella la respuesta se rechaza).
1. Solo SELECT o WITH (lectura). NUNCA INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
2. TODA consulta DEBE incluir un LIMIT (maximo 500), incluso en agregaciones.
3. Fechas = timestamps Unix INTEGER.
   - "Hoy": DATE(col, 'unixepoch', 'localtime') = DATE('now', 'localtime').
   - "Este mes": fecha >= strftime('%s', 'now', 'start of month'). NUNCA uses DATE('now') para "este mes".
4. Config del sistema se consulta con SQL en tabla "config".
5. Si tenes muchos resultados, resume la info clave.
6. Período vacío NO es "sin información": si el rango pedido (hoy, este mes) trae 0 filas, respondé SIEMPRE con la cifra ESCRITA ($0,00 y cantidad 0 cuando corresponda) y una línea de contexto. Si querés, además ampliá la consulta al último período con movimientos (últimos 30/90 días) y avisá el cambio mostrando también esos números ("hoy no hubo ventas: $0,00; te muestro los últimos 30 días: $X"). NUNCA respondas solo "no hay movimientos" ni cierres con una pregunta u oferta en lugar del dato.

## Estilo
- Empezá por el número o resultado y sumá una línea de contexto si aporta; evitá el paso a paso extenso.
- Precisión siempre: los números y las cifras no se omiten.
- Para datos, presenta como frases naturales ("Hoy vendiste $45.000 en 12 ventas").
- Descripciones humanas: "Buscando tus ventas de hoy..." en vez de "Ejecutando SELECT".

## Ejemplos
Pregunta: "Como creo un producto nuevo?"
Respuesta: {tipo: "respuesta", texto: "Para crear un producto tenés dos opciones: 1. Podés pedírmelo acá mismo en el chat diciéndome 'Quiero crear un producto' y te guío paso a paso. 2. O podés ir a la pantalla de Productos > botón 'Nuevo Producto' y completar el formulario."}

Pregunta: "¿Cómo creo un combo?"
Respuesta: {tipo: "respuesta", texto: "Para crear un combo andá a Productos → pestaña Combos → Nuevo Combo. Completá Nombre y Código interno, agregá los productos componentes con sus cantidades, definí el Precio de venta y tocá Guardar. Si el módulo Combos no está activo, activalo primero en Configuración → Módulos y Catálogo."}

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
OBLIGATORIO: toda respuesta de tipo "consulta" lleva SIEMPRE los tres campos id_solicitud, sql y descripcion (nunca omitas descripcion; sin ella la respuesta se rechaza).
Uso del sistema, conversación o guía: {tipo: "respuesta", texto: "Guía con prerrequisito, pasos y camino de menú"}
Recordatorio de tablas: las tablas se arman con los DATOS devueltos (títulos de comerciante y sus números), NUNCA con la consulta ni su SQL: está PROHIBIDO pegar SELECT, FROM, JOIN o bloques \`\`\`sql.

${reglasSeguir}

${reglasCreacion}

${seccionRecordatorios}

${reglasMemoria}

${seccionProveedor}

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

/** Primera pregunta del comerciante en el ciclo (para recuperar el manual). */
function primerMensajeUsuario(mensajes: Array<{ role: string; content: string }>): string {
  for (const m of mensajes) {
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

// --- Red determinística de seguimiento ---
// El prompt pide envolver las preguntas de seguimiento en un bloque ```seguir,
// pero en la práctica el modelo a veces las deja como texto suelto: el
// comerciante las ve y no puede tocarlas. Esta función PURA envuelve el sufijo
// de 2-4 preguntas que el modelo YA escribió; nunca agrega, borra ni reformula
// nada. Si ya hay bloque `seguir`, si hay un bloque `whatsapp`/`mensaje` (ahí
// Binny cierra con el mensaje) o si el sufijo no son 2-4 preguntas válidas, el
// texto queda intacto. Exportada para la evaluación determinística.

/** Normaliza texto para comparar: minúsculas y sin acentos (igual que el resto del archivo). */
function normalizarTexto(texto: string): string {
  return (texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Palabras/frases con las que suele arrancar una pregunta o un pedido del
// comerciante. Se comparan normalizadas (minúsculas y sin acentos), así que en
// la práctica "¿Cómo…", "como…" y "Cómo…" coinciden todas.
const INICIOS_PREGUNTA_SEGUIR: string[] = [
  'cómo', 'como', 'qué', 'que ', 'cuál', 'cual', 'cuánto', 'cuanto',
  'cuántos', 'cuantos', 'cuánta', 'cuándo', 'cuando ', 'dónde', 'donde ',
  'quién', 'quien ', 'por qué', 'para qué', 'hay', 'tenés', 'tenes',
  'podés', 'podes', 'me conviene', 'conviene', 'querés', 'queres',
  'mostrame', 'decime', 'dame', 'mostrá', 'mostra', 'cuánto',
].map((p) => normalizarTexto(p));

/**
 * ¿La línea es una pregunta suelta apta para el bloque de seguimiento?
 * Tolerante con un modelo descuidado: vale con signos (¿…?/) o con un arranque
 * interrogativo/de pedido; descarta viñetas, numeración y líneas largas.
 */
function esPreguntaSueltaDeSeguir(linea: string): boolean {
  const t = (linea ?? '').trim();
  if (t.length === 0 || t.length > 70) return false;
  // Sin viñetas ni numeración al inicio ("-", "*", "•", "1.", "1)").
  if (/^(?:[-*•]|\d+[.)])(?:\s|$)/.test(t)) return false;
  // (a) Pregunta explícita por signos.
  if (t.startsWith('¿') || t.endsWith('?')) return true;
  // (b) Empieza con palabra/frase interrogativa o de pedido.
  const n = normalizarTexto(t);
  return INICIOS_PREGUNTA_SEGUIR.some((p) => n.startsWith(p));
}

export function normalizarSeguir(texto: string): string {
  if (!texto) return texto;
  // Ya tiene bloque seguir → no tocar.
  if (/```seguir\b/.test(texto)) return texto;
  // Cierra con whatsapp/mensaje → no tocar (ahí el bloque no corresponde).
  if (/```(?:whatsapp|mensaje)\b/.test(texto)) return texto;

  // Solo se mira el final: los espacios/saltos de cola no cuentan.
  const sinCola = texto.replace(/\s+$/, '');
  const lineas = sinCola.split(/\r?\n/);

  let inicio = lineas.length;
  while (inicio > 0 && esPreguntaSueltaDeSeguir(lineas[inicio - 1])) inicio--;
  const cantidad = lineas.length - inicio;
  // Sufijo de 2 a 4 líneas-pregunta: una sola, o cinco (o más), no se tocan.
  if (cantidad < 2 || cantidad > 4) return texto;

  // Prefijo sin las líneas vacías sobrantes al final (sin líneas vacías de más).
  let finPrefijo = inicio;
  while (finPrefijo > 0 && lineas[finPrefijo - 1].trim() === '') finPrefijo--;
  const prefijo = lineas.slice(0, finPrefijo).join('\n');
  const preguntas = lineas.slice(inicio).map((l) => l.trim());
  const bloque = ['```seguir', ...preguntas, '```'].join('\n');

  return prefijo.length > 0 ? `${prefijo}\n\n${bloque}` : bloque;
}

// --- Barrera determinística anti-fuga de nombres internos ---
// El prompt pide hablar en lenguaje de comerciante, pero el modelo igual puede
// repetir un nombre interno que vio en el esquema o en un resultado de consulta.
// Esta red garantiza que NINGUNA respuesta salga con un identificador interno:
// reemplaza cada uno por su etiqueta de comerciante (o lo borra, para los flags
// `usar_*`/`vista_*` que no tienen etiqueta). Exportada para la evaluación pura.

/** Identificadores internos que nunca deben aparecer en la respuesta al comerciante. */
export const NOMBRES_INTERNOS: string[] = [
  'gasto_programado',
  'auto_generar',
  'proxima_ejecucion',
  'categoria_gasto',
  'venta_item',
  'venta_pago',
  'precio_costo',
  'stock_minimo',
  'saldo_actual',
  'creada_en',
  'anulada_en',
  'unidad_id',
  'producto_id',
  'cliente_id',
  'turno_caja',
  'movimiento_stock',
  'historial_precio',
  'binny_memoria',
];

/**
 * Nombres de las herramientas internas del agente. No deben aparecer nunca en
 * la respuesta al comerciante (el modelo a veces filtra una llamada cruda).
 */
export const NOMBRES_HERRAMIENTAS: string[] = [
  'ejecutar_consulta',
  'comparar_periodos',
  'predecir_reposicion',
  'obtener_analitica_anomalias',
  'obtener_pildoras_oportunidad',
  'obtener_analitica_abc',
  'obtener_fugas_precio',
  'comparar_cajeros',
  'simular_escenario',
  'guardar_memoria',
];

/** Etiqueta de comerciante para cada nombre interno. */
const ETIQUETAS_INTERNAS: Record<string, string> = {
  gasto_programado: 'pagos programados',
  auto_generar: 'asentamiento automático',
  proxima_ejecucion: 'próximo pago',
  categoria_gasto: 'categoría de gasto',
  venta_item: 'ítems de venta',
  venta_pago: 'pagos de venta',
  precio_costo: 'costo',
  stock_minimo: 'stock mínimo',
  saldo_actual: 'saldo',
  creada_en: 'fecha de creación',
  anulada_en: 'fecha de anulación',
  unidad_id: 'unidad',
  producto_id: 'producto',
  cliente_id: 'cliente',
  turno_caja: 'turno de caja',
  movimiento_stock: 'movimiento de stock',
  historial_precio: 'historial de precios',
  binny_memoria: 'memoria',
};

/**
 * Borra los nombres internos del texto final. Reemplaza cada identificador
 * (como palabra completa, sin distinguir mayúsculas) por su etiqueta de
 * comerciante; los flags `usar_*`/`vista_*` sin etiqueta se eliminan dejando el
 * texto legible. Nunca toca palabras que solo CONTIENEN esas cadenas como
 * substring (el límite de palabra lo evita).
 */
export function quitarNombresInternos(texto: string): string {
  if (!texto) return texto;
  let out = texto;
  // 1) Nombres con etiqueta de comerciante.
  for (const [interno, etiqueta] of Object.entries(ETIQUETAS_INTERNAS)) {
    out = out.replace(new RegExp(`\\b${interno}\\b`, 'gi'), etiqueta);
  }
  // 2) Flags de módulo/vista internos: se borran (no tienen etiqueta propia).
  out = out.replace(/\b(?:usar_|vista_)[a-z0-9_]+\b/gi, ' ');
  // 3) Residuales: cualquier otro nombre interno de la lista que haya quedado.
  // 0) Llamadas a herramientas filtradas por el modelo (ej: comparar_periodos({dias: 30}))
  out = out.replace(
    new RegExp(`\\b(?:${NOMBRES_HERRAMIENTAS.join('|')})\\s*\\([^)]*\\)`, 'gi'),
    ' ',
  );
  for (const interno of NOMBRES_INTERNOS) {
    out = out.replace(new RegExp(`\\b${interno}\\b`, 'gi'), ' ');
  }
  for (const herramienta of NOMBRES_HERRAMIENTAS) {
    out = out.replace(new RegExp(`\\b${herramienta}\\b`, 'gi'), ' ');
  }
  // Limpieza: sin dobles espacios, sin espacio antes de puntuación ni de salto.
  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^[ \t]+/, '');
  return out;
}

/**
 * Texto final listo para el comerciante: normaliza el bloque de seguimiento y,
 * como garantía dura, borra cualquier nombre interno que se haya escapado.
 */
export function limpiarTextoFinal(texto: string): string {
  return quitarNombresInternos(normalizarSeguir(texto));
}

// --- Guardián anti-promesa-falsa (Etapa 1) ---
// Detecta cuando el modelo promete una tarjeta ("revisá la tarjeta", "hacé
// clic en confirmar") pero no emitió ningún bloque autorizado. En ese caso se
// hace UN reintento con feedback explícito; si persiste, se loguea.

// Únicos bloques visuales permitidos: no escriben datos del negocio, solo se
// muestran (gráfico, mensaje de WhatsApp, mensaje destacado y seguimiento
// sugerido). Las tarjetas de creación se eliminaron por completo: Binny ya no
// crea ni modifica datos. Exportado para la evaluación determinística.
export const FENCES_AUTORIZADOS = ['chart', 'whatsapp', 'mensaje', 'seguir'];



// --- Reintento de pasos auxiliares a prueba de fallos ---

/**
 * ¿El error del proveedor merece un reintento? Solo 5xx (fallo transitorio del
 * servidor) y 429 (rate limit). Un 4xx distinto (payload inválido, auth) no se
 * reintenta: volvería a fallar igual.
 */
function esReintentableProveedor(error: unknown): boolean {
  const mensaje = error instanceof Error ? error.message : String(error);
  const match = /\(código (\d{3})\)/.exec(mensaje);
  if (!match) return false;
  const codigo = Number(match[1]);
  return codigo >= 500 || codigo === 429;
}

/** Resultado de un paso auxiliar: ok=true con el valor, o ok=false con el error. */
export type ResultadoAuxiliar<T> = { ok: true; valor: T } | { ok: false; error: unknown };

/**
 * Ejecuta un paso AUXILIAR del ciclo (memoria automática, guardián
 * anti-tarjeta-fantasma, reintento de SQL) a prueba de fallos.
 *
 * Una falla auxiliar NUNCA debe abortar la respuesta al comerciante: si el
 * proveedor responde 5xx/429 se reintenta UNA vez (sin espera larga); cualquier
 * fallo —antes o después del reintento— se registra en el log y se devuelve
 * `{ ok: false }` para que el llamador siga con el texto que ya tiene. No
 * propaga el throw: el `ok: false` permite distinguir "el paso no pudo correr"
 * de "el paso corrió y devolvió null" (sin corrección posible).
 */
export async function auxiliarConReintento<T>(
  nombre: string,
  ejecutar: () => Promise<T>,
): Promise<ResultadoAuxiliar<T>> {
  try {
    return { ok: true, valor: await ejecutar() };
  } catch (error) {
    if (esReintentableProveedor(error)) {
      console.warn(`[chat] ${nombre} falló con error reintentable; reintentando una vez:`, error);
      try {
        return { ok: true, valor: await ejecutar() };
      } catch (errorReintento) {
        console.error(`[chat] ${nombre} falló tras el reintento:`, errorReintento);
        return { ok: false, error: errorReintento };
      }
    }
    console.error(`[chat] ${nombre} falló:`, error);
    return { ok: false, error };
  }
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

export class ChatService {
  async preguntar(data: PreguntarDTO): Promise<RespuestaLLM> {
    const lic = await validarLicenciaChat(data.clave, data.instalacion_id);

    // Incremento atómico (solo si < limite)
    const usoCheck = await incrementarMensajes(lic.id);
    if (!usoCheck) {
      const limite = await obtenerLimiteChat(lic.id);
      throw httpError(
        `Alcanzaste tu limite mensual de ${limite} consultas del asistente. Se renueva el dia 1 del proximo mes.`,
        429,
      );
    }
    const uso = usoCheck!;

    const mensajes: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: construirPromptSistema('json', data.contexto, data.pregunta) },
      { role: 'system', content: mensajeCuotaSistema(uso) },
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
      respuesta!.texto = quitarNombresInternos(respuesta!.texto);
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
      respuesta.texto = quitarNombresInternos(respuesta.texto);
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
      throw httpError(
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
      throw httpError(
        `Alcanzaste tu limite mensual de ${limite} consultas del asistente. Se renueva el dia 1 del proximo mes.`,
        429,
      );
    }
    const uso = usoCheck!;

    const mensajes: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: construirPromptSistema('fase1', data.contexto, data.pregunta) },
      { role: 'system', content: mensajeCuotaSistema(uso) },
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
          // SQL inválido → 1 reintento con llamarLLM (JSON, feedback).
          // Paso auxiliar: si el proveedor cae (5xx/429) se reintenta una vez y,
          // si persiste, se degrada con un mensaje amable en vez de romper.
          mensajes.push({
            role: 'assistant',
            content: JSON.stringify(evento.respuesta),
          });
          mensajes.push({
            role: 'user',
            content: `Tu consulta fue rechazada: ${validacion.error}. Regenerá SOLO el JSON {tipo:"consulta", id_solicitud, sql, descripcion} con SQL válido: solo SELECT o WITH, LIMIT ≤ 500, una sola sentencia.`,
          });
          const intento = await auxiliarConReintento('reintento de SQL en preguntarStream', () =>
            llamarLLM(mensajes, { jsonMode: true, model: modelo }),
          );
          if (!intento.ok) {
            yield { type: 'error', texto: 'No pude generar la consulta. ¿Podés reformular la pregunta?' };
          } else {
            const retry = intento.valor;
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
          }
        }
      } else if (evento.type === 'done') {
        tokensFinales = evento.tokens ?? tokensFinales;
        // Red determinística: si el modelo dejó 2-3 preguntas sueltas al final,
        // se envuelven en el bloque ```seguir antes de mandar/persistir el texto.
        const textoFinal = limpiarTextoFinal(textoAcumulado);
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
      throw httpError(
        `Alcanzaste tu limite mensual de ${limite} consultas del asistente. Se renueva el dia 1 del proximo mes.`,
        429,
      );
    }
    const uso = usoCheck!;

    const mensajes: AgenteMessage[] = [
      { role: 'system', content: construirPromptSistema('agente', data.contexto, data.pregunta) },
      { role: 'system', content: mensajeCuotaSistema(uso) },
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
      { role: 'system', content: construirPromptSistema('agente', data.contexto, primerMensajeUsuario(historialRecortado)) },
      { role: 'system', content: mensajeCuotaSistema(uso) },
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
                const textoCierre = limpiarTextoFinal(ev2.texto);
                auditarTextoFinal('agente-cierre-duplicado', textoCierre);
                yield { type: 'done', texto: textoCierre, tokens: tokensFinales, uso };
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
          // Se reenvían tal cual: el desktop valida el SQL y ejecuta localmente.
          // Si el desktop rechaza un tool call, devuelve el error como resultado
          // role:"tool" y el loop continúa para que el LLM se autocorrija.
          yield { type: 'herramienta', tool_calls: evento.tool_calls, uso };
        }
      } else if (evento.type === 'done') {
        tokensFinales = evento.tokens ?? tokensFinales;
        let textoFinal = evento.texto;
        // Si el turno derivó el cierre a un reintento interno (memoria), el
        // done final ya se emitió ahí o el turno sigue vía tool: no duplicar.
        let omitirDoneFinal = false;
        const textoUsuariosDone = mensajes
          .filter((m) => m.role === 'user' && m.content.trim().length > 0)
          .map((m) => m.content)
          .join('\n');
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
          // Paso AUXILIAR a prueba de fallos: si el proveedor falla se degrada
          // al texto original (nunca se propaga el throw ni se rompe la respuesta).
          try {
            let emitioSalida = false;
            for (let intento = 0; intento < 2; intento++) {
              let reintentar = false;
              for await (const evM of llamarLLMAgenteStream(mensajes, HERRAMIENTAS_AGENTE, { model: modelo, forzarHerramienta: 'guardar_memoria' })) {
                if (evM.type === 'chunk' && evM.texto) {
                  emitioSalida = true;
                  yield { type: 'chunk', texto: evM.texto };
                } else if (evM.type === 'herramienta') {
                  // Se reenvía: el desktop la ejecuta directo (automatico) o con tarjeta.
                  emitioSalida = true;
                  yield { type: 'herramienta', tool_calls: evM.tool_calls, uso };
                  omitirDoneFinal = true;
                } else if (evM.type === 'done') {
                  if (!omitirDoneFinal) {
                    emitioSalida = true;
                    tokensFinales = evM.tokens ?? tokensFinales;
                    textoFinal = limpiarTextoFinal(evM.texto);
                    yield { type: 'done', texto: textoFinal, tokens: tokensFinales, uso };
                    omitirDoneFinal = true;
                  }
                } else if (evM.type === 'error') {
                  // Fallo transitorio del proveedor y todavía no se emitió nada
                  // al cliente → reintenta UNA vez; si no, degrada al texto original.
                  if (intento === 0 && !emitioSalida && esReintentableProveedor(new Error(evM.texto))) {
                    reintentar = true;
                  }
                  break;
                }
              }
              if (!reintentar) break;
              console.warn('[Binny-memoria] el proveedor falló (reintentable); reintentando una vez');
            }
          } catch (error) {
            console.error('[Binny-memoria] falló el paso auxiliar de memoria:', error);
          }
        }
        if (!omitirDoneFinal) {
          textoFinal = limpiarTextoFinal(textoFinal);
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

    const textoFinal = respuesta.tipo === 'respuesta' ? quitarNombresInternos(respuesta.texto) : '';
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

    const textoFinal = respuesta.tipo === 'respuesta' ? quitarNombresInternos(respuesta.texto) : '';
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
      name: 'guardar_memoria',
      description:
        'Guarda un dato estable del negocio (proveedor habitual, rubro, preferencia, horario) para recordarlo en futuras charlas. Si el dato surgió de pasada en la conversación (nadie pidió guardarlo), poné automatico:true: se guarda directo, sin tarjeta, y avisale con una frase corta ("Lo anoté"). Si el comerciante pidió explícitamente recordar algo, poné automatico:false.',
      parameters: {
        type: 'object',
        properties: {
          contenido: { type: 'string' },
          categoria: { type: 'string', description: 'proveedores, preferencias, rubro, clientes u otro.' },
          automatico: { type: 'boolean', description: 'true = guardar directo sin tarjeta (dato de pasada); false = pedido explícito.' },
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
    {
      type: 'function',
      function: {
        name: 'predecir_reposicion',
        description:
          'Calcula qué y cuánto reponer basado en ventas reales de los últimos 45 días y stock actual. Usala cuando el comerciante pregunte qué comprar, qué reponer o si va a tener quiebre.',
        parameters: {
          type: 'object',
          properties: {
            dias_cobertura: { type: 'number', description: 'Días de cobertura deseados (3-60). Por defecto 14.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'obtener_analitica_anomalias',
        description:
          'Detecta anomalías recientes (tickets atípicos, turnos con muchas anulaciones, compras con sobrecosto, ajustes de stock). Usala para auditorías rápidas sin escribir SQL.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'obtener_pildoras_oportunidad',
        description:
          'Devuelve oportunidades detectadas localmente (quiebres inminentes, capital parado, combos sugeridos, gastos desalineados). Usala para dar un diagnóstico proactivo del negocio.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'comparar_periodos',
        description:
          'Compara dos períodos de N días: el último período vs el anterior. Devuelve ventas, tickets, ticket promedio, margen, gastos, compras y deltas %. Usala para "vs mes pasado", "vs semana pasada", "cómo vengo este mes".',
        parameters: {
          type: 'object',
          properties: {
            dias: { type: 'number', description: 'Tamaño del período en días (7-90). Por defecto 30. Compara últimos N días vs N días previos.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'obtener_analitica_abc',
        description:
          'Clasifica el catálogo por curva ABC (Pareto) según facturación y margen de los últimos 90 días. Usala para decidir qué mantener, revisar o liquidar.',
        parameters: {
          type: 'object',
          properties: {
            limite: { type: 'number', description: 'Cuántos productos top devolver por clase (5-30). Por defecto 15.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'obtener_fugas_precio',
        description:
          'Detecta ventas a pérdida (precio_unitario < precio_costo) de los últimos 90 días, con ranking por pérdida acumulada. Usala para auditar precios desactualizados o errores de carga.',
        parameters: {
          type: 'object',
          properties: {
            dias: { type: 'number', description: 'Ventana en días (7-180). Por defecto 90.' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'comparar_cajeros',
        description:
          'Compara desempeño por cajero/operador en los últimos N días: turnos cerrados, diferencias de caja, ratio de anulaciones y ticket promedio. Usala para auditoría de turnos sin señalar.',
        parameters: {
          type: 'object',
          properties: {
            dias: { type: 'number', description: 'Ventana en días (7-90). Por defecto 30.' },
          },
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

