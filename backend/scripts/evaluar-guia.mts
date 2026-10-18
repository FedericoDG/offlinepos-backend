/**
 * Evaluación del "modo guía" de Binny (T6).
 *
 * Mide si una pregunta de comerciante del tipo "¿cómo…?" produce una GUÍA
 * correcta (prerrequisito → pasos → camino de menú), sin prometer tarjetas ni
 * bloques de creación.
 *
 * Modos:
 *   npx tsx scripts/evaluar-guia.mts         → determinístico (siempre, sin red)
 *   npx tsx scripts/evaluar-guia.mts --llm   → además puntúa al modelo real
 *
 * En modo determinístico valida:
 *   (a) cada pregunta recupera la pantalla esperada del manual
 *       (`recuperarDetalleManual` devuelve la entrada `pantalla_esperada`);
 *   (b) el prompt inyecta el índice del manual y el detalle recuperado;
 *   (c) el prompt NO enseña a emitir bloques de creación en ningún modo;
 *   (d) el corpus está bien formado (ids únicos, pantalla existente, criterios).
 *
 * En modo `--llm` pide al modelo la respuesta de cada pregunta y puntúa
 * `debe_mencionar` (menú/prerrequisito) y `no_debe` (bloques/tarjetas). Escribe
 * el reporte en /tmp/opencode/evaluacion-guia.md.
 *
 * Si el `.env` no tiene credenciales del LLM, el modo `--llm` lo informa y el
 * código de salida queda gobernado por el determinístico.
 */
import '../pruebas/entorno';
import fs from 'node:fs';
import path from 'node:path';

import { construirPromptSistema, FENCES_AUTORIZADOS, normalizarSeguir, quitarNombresInternos } from '../src/features/chat/chat.service';
import { MANUAL_ENTRADAS, recuperarDetalleManual } from '../src/features/chat/chat.manual';
import {
  CORPUS_GUIA_EVALUACION,
  NO_DEBE_GLOBAL,
  type CasoGuiaEvaluacion,
} from '../src/features/chat/chat.guia.evaluacion';
import {
  CORPUS_BINNY_EVALUACION,
  NO_DEBE_BINNY_GLOBAL,
  TERMINOS_TECNICOS_SEGUIR,
  type CasoBinnyEvaluacion,
} from '../src/features/chat/chat.binny.evaluacion';
import { cumpleRespuestaCompleta, cumpleSinDisculpas, cumpleSinOfrecerLoPedido } from '../src/features/chat/chat.prueba.e2e';
import type { ContextoNegocioDTO } from '../src/features/chat/chat.dtos';

const MODO_LLM = process.argv.includes('--llm');
const RUTA_REPORTE = '/tmp/opencode/evaluacion-guia.md';

/** Modos cuyo prompt incluye el manual (índice + detalle recuperado). */
const MODOS_CON_MANUAL = ['json', 'stream', 'fase1', 'agente'] as const;
const MODOS = ['json', 'stream', 'fase1', 'agente', 'brief', 'informe'] as const;
const TITULO_INDICE = '## Manual de la interfaz (índice de pantallas)';

/** Identificadores de bloques de creación que NUNCA deben aparecer en el prompt. */
const FENCES_PROHIBIDOS = [
  'crear_producto',
  'crear_proveedor',
  'crear_gasto',
  'crear_recordatorio',
  'crear_compra',
  'crear_combo',
  'cambiar_modulo',
  '```crear',
];

const CONTEXTO: ContextoNegocioDTO = {
  usar_iva: false,
  fecha_actual: '2026-10-08',
  hora_actual: '10:30',
  dia_semana: 'jueves',
  modulos_activos: {
    usar_marca: true, usar_categoria: true, categoria_multiple: false,
    usar_presentaciones: true, usar_iva: false, usar_proveedor: true,
    usar_gastos: true, usar_clientes: true, usar_presupuestos: true,
    usar_combos: true, usar_promociones: true, usar_vencimientos: true,
    usar_etiquetas: true, usar_recargos: true, usar_recordatorios: true,
    usar_balanza: true,
  },
};

/**
 * Contexto para los casos de desambiguación/seguimiento: incluye un resumen
 * precocinado para que las preguntas claras sean respondibles sin herramientas
 * (el eval llama al modelo sin function calling).
 */
const CONTEXTO_BINNY: ContextoNegocioDTO = {
  ...CONTEXTO,
  resumen_negocio: [
    '- Ventas de hoy: $45.000 en 12 ventas',
    '- Ventas de esta semana: $310.000',
    '- Ventas de este mes: $1.240.000',
    '- Gastos de hoy: $12.000',
    '- Gastos de esta semana: $95.000',
    '- Gastos de este mes: $380.000',
    '- Deudas de clientes: 5 clientes deben $120.000 en total',
    '- Productos con stock bajo: 7',
  ].join('\n'),
};

// --- Utilidades ---

function normalizar(texto: string): string {
  return (texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normalización para comparar texto del modelo contra `debe_mencionar`:
 * además de minúsculas/sin acentos, colapsa espacios y quita los espacios
 * alrededor de "+" (así "Ctrl + K" y "Ctrl+K" son equivalentes).
 */
function normalizarMatch(texto: string): string {
  return normalizar(texto).replace(/\s*\+\s*/g, '+').replace(/\s+/g, ' ').trim();
}

/** Detecta un fence de creación (```crear_producto, ```cambiar_modulo, ...). */
function tieneFenceCreacion(texto: string): string | null {
  const m = texto.match(/```\s*(crear[_-]?\w*|cambiar[_-]?\w*)/i);
  return m ? m[0].trim() : null;
}

/** Quita SOLO los bloques ```seguir (para evaluar el texto principal). */
function quitarBloquesSeguir(texto: string): string {
  return texto.replace(/```seguir[\s\S]*?```/gi, ' ');
}

/**
 * Detecta filtración de SQL/código en la respuesta al comerciante (el bug real:
 * Binny mostró el SELECT de ventas bajo costo). Criterio determinístico:
 * un bloque de código ```sql, un SELECT … FROM o un JOIN. Devuelve la etiqueta
 * del patrón encontrado, o null si el texto está limpio.
 */
function contieneSql(texto: string): string | null {
  const t = texto ?? '';
  if (/```\s*sql\b/i.test(t)) return 'bloque ```sql';
  if (/\bselect\b[\s\S]*?\bfrom\b/i.test(t)) return 'SELECT … FROM';
  if (/\bjoin\b/i.test(t)) return 'JOIN';
  return null;
}

/** Líneas del primer bloque ```seguir del texto, o null si no hay bloque. */
function extraerLineasSeguir(texto: string): string[] | null {
  const m = [...texto.matchAll(/```seguir\s*\r?\n([\s\S]*?)```/gi)];
  if (m.length === 0) return null;
  return m[0][1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const nombrePorId = new Map(MANUAL_ENTRADAS.map((e) => [e.id, e.nombre]));

// --- Verificaciones determinísticas ---

interface Falla {
  check: string;
  detalle: string;
}

function verificarDeterministico(): Falla[] {
  const fallas: Falla[] = [];

  // (d) Corpus bien formado.
  const ids = new Set<string>();
  for (const caso of CORPUS_GUIA_EVALUACION) {
    if (ids.has(caso.id)) fallas.push({ check: `corpus:${caso.id}`, detalle: 'id duplicado' });
    ids.add(caso.id);
    if (!nombrePorId.has(caso.pantalla_esperada)) {
      fallas.push({
        check: `corpus:${caso.id}`,
        detalle: `pantalla_esperada inexistente en el manual: "${caso.pantalla_esperada}"`,
      });
    }
    if (caso.debe_mencionar.length === 0) {
      fallas.push({ check: `corpus:${caso.id}`, detalle: 'sin debe_mencionar' });
    }
  }

  // (a) Recuperación: la pregunta devuelve la pantalla esperada.
  for (const caso of CORPUS_GUIA_EVALUACION) {
    const nombre = nombrePorId.get(caso.pantalla_esperada);
    if (!nombre) continue;
    const detalle = recuperarDetalleManual(caso.pregunta);
    if (!detalle.includes(`### ${nombre}`)) {
      const recuperadas = [...detalle.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
      fallas.push({
        check: `recuperacion:${caso.id}`,
        detalle: `no recuperó "${nombre}" (recuperó: ${recuperadas.join(' | ') || 'nada'})`,
      });
    }
  }

  // (b) El prompt inyecta el manual (índice siempre + detalle por pregunta).
  for (const modo of MODOS_CON_MANUAL) {
    const prompt = construirPromptSistema(modo, CONTEXTO, CORPUS_GUIA_EVALUACION[0].pregunta);
    if (!prompt.includes(TITULO_INDICE)) {
      fallas.push({ check: `prompt:${modo}`, detalle: 'no incluye el índice del manual' });
    }
    const nombre = nombrePorId.get(CORPUS_GUIA_EVALUACION[0].pantalla_esperada);
    if (nombre && !prompt.includes(`### ${nombre}`)) {
      fallas.push({ check: `prompt:${modo}`, detalle: `no inyecta el detalle de "${nombre}"` });
    }
  }

  // (c) Ningún modo enseña a emitir bloques de creación.
  for (const modo of MODOS) {
    const prompt = construirPromptSistema(modo, CONTEXTO, '¿cómo creo un producto?');
    for (const token of FENCES_PROHIBIDOS) {
      if (prompt.includes(token)) {
        fallas.push({ check: `prompt:${modo}`, detalle: `contiene bloque de creación prohibido: ${token}` });
      }
    }
    const fence = tieneFenceCreacion(prompt);
    if (fence) {
      fallas.push({ check: `prompt:${modo}`, detalle: `contiene fence de creación: ${fence}` });
    }
  }

  return fallas;
}

// --- Verificaciones determinísticas (desambiguación + seguimiento) ---

/** Modos conversacionales que deben describir el bloque `seguir` y la regla de desambiguación. */
const MODOS_CON_SEGUIR = ['json', 'stream', 'agente'] as const;

/** Ejemplo exacto del bloque `seguir` que el prompt debe enseñar. */
const EJEMPLO_SEGUIR = [
  '¿Cómo viene la cobranza?',
  '¿Qué productos tengo sin movimiento?',
  '¿Cuánto gasté este mes?',
];

/** Regla compartida (reglasComunes) que prohíbe filtrar SQL o código. */
const REGLA_SIN_SQL = 'PROHIBIDO mostrar SQL o código';

/** Reglas nuevas (reglasComunes): no disculparse y hacer lo pedido sin ofrecerlo. */
const REGLA_SIN_DISCULPAS = 'Nunca te disculpes ni hables de vos mismo';
const REGLA_HACER_NO_OFRECER = 'Hacé lo que te piden, no ofrezcas hacerlo';

/** Recordatorio de la sección "Formato de respuesta": tablas con datos, no SQL. */
const RECORDATORIO_TABLAS = 'NUNCA con la consulta';

function verificarBinnyDeterministico(): Falla[] {
  const fallas: Falla[] = [];

  // (e) El bloque `seguir` está autorizado (junto con los visuales clásicos).
  for (const lenguaje of ['chart', 'whatsapp', 'mensaje', 'seguir']) {
    if (!FENCES_AUTORIZADOS.includes(lenguaje)) {
      fallas.push({
        check: 'fences:seguir',
        detalle: `"${lenguaje}" no está en FENCES_AUTORIZADOS (${FENCES_AUTORIZADOS.join(', ')})`,
      });
    }
  }

  // (f) El prompt describe el bloque `seguir` con el formato exacto y la regla
  // de desambiguación, en los modos conversacionales.
  for (const modo of MODOS_CON_SEGUIR) {
    const prompt = construirPromptSistema(modo, CONTEXTO_BINNY, '¿Cuánto vendí?');
    if (!prompt.includes('```seguir')) {
      fallas.push({ check: `prompt:${modo}`, detalle: 'no describe el bloque ```seguir' });
    }
    for (const linea of EJEMPLO_SEGUIR) {
      if (!prompt.includes(linea)) {
        fallas.push({ check: `prompt:${modo}`, detalle: `el ejemplo de seguir no incluye: "${linea}"` });
      }
    }
    if (!prompt.includes('Desambiguación')) {
      fallas.push({ check: `prompt:${modo}`, detalle: 'no incluye la regla de desambiguación' });
    }
  }

  // (g) Corpus Binny bien formado.
  const ids = new Set<string>();
  for (const caso of CORPUS_BINNY_EVALUACION) {
    if (ids.has(caso.id)) fallas.push({ check: `corpusBinny:${caso.id}`, detalle: 'id duplicado' });
    ids.add(caso.id);
    if (caso.tipo !== 'desambiguacion' && caso.tipo !== 'seguimiento' && caso.tipo !== 'datos') {
      fallas.push({ check: `corpusBinny:${caso.id}`, detalle: `tipo inválido "${caso.tipo}"` });
    }
    if (caso.tipo === 'desambiguacion' && typeof caso.espera_repregunta !== 'boolean') {
      fallas.push({ check: `corpusBinny:${caso.id}`, detalle: 'desambiguación sin espera_repregunta' });
    }
    if (caso.tipo !== 'desambiguacion' && caso.espera_repregunta !== undefined) {
      fallas.push({ check: `corpusBinny:${caso.id}`, detalle: `${caso.tipo} no debe definir espera_repregunta` });
    }
    if (
      caso.tipo === 'desambiguacion' &&
      caso.debe_mencionar.length === 0 && caso.debe_mencionar_alguna.length === 0
    ) {
      fallas.push({ check: `corpusBinny:${caso.id}`, detalle: 'desambiguación sin criterio de mención' });
    }
    if (caso.tipo === 'datos' && caso.debe_mencionar_alguna.length === 0) {
      fallas.push({ check: `corpusBinny:${caso.id}`, detalle: 'datos sin títulos/datos legibles esperados' });
    }
  }
  const desamb = CORPUS_BINNY_EVALUACION.filter((c) => c.tipo === 'desambiguacion');
  if (desamb.filter((c) => c.espera_repregunta === true).length < 2) {
    fallas.push({ check: 'corpusBinny:desambiguacion', detalle: 'faltan casos ambiguos (deben repreguntar)' });
  }
  if (desamb.filter((c) => c.espera_repregunta === false).length < 2) {
    fallas.push({ check: 'corpusBinny:desambiguacion', detalle: 'faltan casos claros (no deben repreguntar)' });
  }
  if (CORPUS_BINNY_EVALUACION.filter((c) => c.tipo === 'seguimiento').length < 3) {
    fallas.push({ check: 'corpusBinny:seguimiento', detalle: 'faltan casos de seguimiento' });
  }
  if (CORPUS_BINNY_EVALUACION.filter((c) => c.tipo === 'datos').length < 2) {
    fallas.push({ check: 'corpusBinny:datos', detalle: 'faltan casos de datos (sin SQL)' });
  }

  // (h) La regla anti-SQL viaja en el prompt compartido (todos los modos) y el
  // recordatorio de tablas vive en la sección "Formato de respuesta".
  for (const modo of MODOS) {
    const prompt = construirPromptSistema(modo, CONTEXTO_BINNY, '¿Vendí productos bajo costo?');
    if (!prompt.includes(REGLA_SIN_SQL)) {
      fallas.push({ check: `prompt:${modo}`, detalle: 'no incluye la regla "PROHIBIDO mostrar SQL o código"' });
    }
  }
  if (!construirPromptSistema('json', CONTEXTO_BINNY, '¿Vendí productos bajo costo?').includes(RECORDATORIO_TABLAS)) {
    fallas.push({ check: 'prompt:json', detalle: 'Formato de respuesta sin recordatorio de tablas con datos' });
  }

  // (i) Las reglas anti-disculpa y anti-ofrecimiento viajan en el prompt
  // compartido (reglasComunes) en TODOS los modos.
  for (const modo of MODOS) {
    const prompt = construirPromptSistema(modo, CONTEXTO_BINNY, '¿Qué me conviene reponer primero?');
    if (!prompt.includes(REGLA_SIN_DISCULPAS)) {
      fallas.push({ check: `prompt:${modo}`, detalle: `no incluye la regla "${REGLA_SIN_DISCULPAS}"` });
    }
    if (!prompt.includes(REGLA_HACER_NO_OFRECER)) {
      fallas.push({ check: `prompt:${modo}`, detalle: `no incluye la regla "${REGLA_HACER_NO_OFRECER}"` });
    }
  }

  return fallas;
}

// --- Verificaciones determinísticas de `normalizarSeguir` (red de seguridad) ---
//
// El prompt pide el bloque ```seguir, pero el modelo a veces deja 2-3 preguntas
// sueltas al final. `normalizarSeguir` las envuelve (pura, sin inventar nada).
// Esta tabla fija el comportamiento exacto antes de persistir/mandar el texto.

interface CasoNormalizar {
  id: string;
  entrada: string;
  espera: 'envuelve' | 'intacto';
}

/** Texto real de la evidencia: chart + 3 preguntas sueltas (el bug reportado). */
const EVIDENCIA_CHART_3_PREGUNTAS = [
  'Hoy vendiste $45.000 en 12 ventas.',
  '',
  '```chart',
  '{"tipo":"barra","titulo":"Ventas por dia","categorias":["Lun","Mar"],"valores":[12000,18500]}',
  '```',
  '',
  '¿Cómo viene la cobranza?',
  '¿Qué productos tengo sin movimiento?',
  '¿Cuánto gasté este mes?',
].join('\n');

/** Caso REAL reportado: 3 preguntas, la última SIN "¿" ni "?" (empieza con "Cuántos"). */
const EVIDENCIA_REAL_SIN_SIGNO = [
  '¿Qué productos impulsaron este crecimiento?',
  '¿Cómo fue el ticket promedio este mes?',
  'Cuántos tickets cerraste en lo que va del mes',
].join('\n');

const CASOS_NORMALIZAR: CasoNormalizar[] = [
  {
    id: 'dos_preguntas',
    entrada: 'Hoy vendiste $45.000 en 12 ventas.\n\n¿Querés ver la semana?\n¿Y el mes pasado?',
    espera: 'envuelve',
  },
  {
    id: 'tres_preguntas_evidencia',
    entrada: EVIDENCIA_CHART_3_PREGUNTAS,
    espera: 'envuelve',
  },
  {
    id: 'caso_real_sin_signo',
    entrada: EVIDENCIA_REAL_SIN_SIGNO,
    espera: 'envuelve',
  },
  {
    id: 'cuatro_preguntas',
    entrada: 'Hoy vendiste $45.000.\n\n¿Querés ver la semana?\n¿Y el mes?\n¿Y ayer?\n¿Y el año?',
    espera: 'envuelve',
  },
  {
    id: 'ya_tiene_fence',
    entrada: 'Hoy vendiste $45.000.\n\n```seguir\n¿Querés ver la semana?\n¿Y el mes?\n```',
    espera: 'intacto',
  },
  {
    id: 'bloque_whatsapp',
    entrada: 'Le mandé el resumen al cliente.\n\n```whatsapp\nHola, te paso el total del día.\n```\n\n¿Querés ver la semana?\n¿Y el mes?',
    espera: 'intacto',
  },
  {
    id: 'bloque_mensaje',
    entrada: 'Cierre de caja listo.\n\n```mensaje\nCaja cerrada sin diferencias.\n```\n\n¿Querés ver la semana?\n¿Y el mes?',
    espera: 'intacto',
  },
  {
    id: 'una_sola_pregunta',
    entrada: 'Hoy vendiste $45.000.\n\n¿Querés ver la semana?',
    espera: 'intacto',
  },
  {
    id: 'cinco_preguntas',
    entrada: 'Hoy vendiste $45.000.\n\n¿Querés ver la semana?\n¿Y el mes?\n¿Y ayer?\n¿Y el año?\n¿Y el mes pasado?',
    espera: 'intacto',
  },
  {
    id: 'parrafo_normal_3_oraciones',
    entrada: 'Hoy vendiste $245.667 en 13 ventas.\nEl ticket promedio fue de $18.897.\nLos más vendidos fueron gaseosas y pan.',
    espera: 'intacto',
  },
  {
    id: 'lista_con_vinetas',
    entrada: 'Mirá estos atajos:\n\n- ¿Querés ver la semana?\n- ¿Y el mes?\n- ¿Y ayer?',
    espera: 'intacto',
  },
  {
    id: 'respuesta_corta',
    entrada: 'Hoy vendiste $245.667 en 13 ventas.',
    espera: 'intacto',
  },
  {
    id: 'pregunta_larga_corta_el_sufijo',
    entrada: 'Hoy vendiste $45.000.\n\n¿Querés ver la semana?\n¿Querés que te compare este mes contra el mes pasado completo y el anterior?',
    espera: 'intacto',
  },
];

function verificarNormalizarSeguir(): { fallas: Falla[]; filas: string[] } {
  const fallas: Falla[] = [];
  const filas: string[] = [];
  for (const caso of CASOS_NORMALIZAR) {
    const salida = normalizarSeguir(caso.entrada);
    const tieneBloque = /```seguir\b/.test(salida);
    const intacto = salida === caso.entrada;
    const ok =
      caso.espera === 'envuelve'
        ? tieneBloque && salida.trim().endsWith('```')
        : intacto;
    filas.push(
      `| ${caso.id.padEnd(30)} | ${caso.espera.padEnd(8)} | ${(tieneBloque ? 'sí' : 'no').padEnd(9)} | ${(intacto ? 'intacto' : 'modificado').padEnd(10)} | ${ok ? '✓' : '✗'} |`,
    );
    if (!ok) {
      fallas.push({
        check: `normalizar:${caso.id}`,
        detalle: `esperado "${caso.espera}" (bloque=${tieneBloque}, intacto=${intacto})`,
      });
    }
  }
  return { fallas, filas };
}

// --- Verificaciones determinísticas de `quitarNombresInternos` (barrera dura) ---
//
// Garantiza que NINGUNA respuesta salga con un nombre interno de la base: cada
// identificador se reemplaza por su etiqueta de comerciante y los flags
// `usar_*`/`vista_*` se borran dejando el texto legible. Nunca toca palabras que
// solo CONTIENEN esas cadenas como substring (límite de palabra).

interface CasoQuitarNombres {
  id: string;
  entrada: string;
  espera: string;
}

const CASOS_QUITAR_NOMBRES: CasoQuitarNombres[] = [
  {
    id: 'auto_generar',
    entrada: 'El pago tiene auto_generar activado.',
    espera: 'El pago tiene asentamiento automático activado.',
  },
  {
    id: 'gasto_programado',
    entrada: 'Revisá los gasto_programado vigentes.',
    espera: 'Revisá los pagos programados vigentes.',
  },
  {
    id: 'proxima_ejecucion',
    entrada: 'La fecha de proxima_ejecucion es el viernes.',
    espera: 'La fecha de próximo pago es el viernes.',
  },
  {
    id: 'saldo_stock',
    entrada: 'El saldo_actual y el stock_minimo.',
    espera: 'El saldo y el stock mínimo.',
  },
  {
    id: 'vista_se_borra',
    entrada: 'La vista_ventas_detalle muestra todo.',
    espera: 'La muestra todo.',
  },
  {
    id: 'usar_se_borra',
    entrada: 'El módulo usar_combos está activo.',
    espera: 'El módulo está activo.',
  },
  {
    id: 'case_insensitive',
    entrada: 'AUTO_GENERAR',
    espera: 'asentamiento automático',
  },
  {
    id: 'texto_normal_intacto',
    entrada: 'Hoy vendiste $45.000 en 12 ventas.',
    espera: 'Hoy vendiste $45.000 en 12 ventas.',
  },
  {
    id: 'substring_no_toca',
    entrada: 'El gasto_programadoX y megasto_programado no se tocan.',
    espera: 'El gasto_programadoX y megasto_programado no se tocan.',
  },
];

function verificarQuitarNombresInternos(): { fallas: Falla[]; filas: string[] } {
  const fallas: Falla[] = [];
  const filas: string[] = [];
  for (const caso of CASOS_QUITAR_NOMBRES) {
    const salida = quitarNombresInternos(caso.entrada);
    const ok = salida === caso.espera;
    filas.push(
      `| ${caso.id.padEnd(22)} | ${caso.espera.padEnd(42)} | ${salida.padEnd(42)} | ${ok ? '✓' : '✗'} |`,
    );
    if (!ok) {
      fallas.push({
        check: `nombresInternos:${caso.id}`,
        detalle: `esperado "${caso.espera}" · obtenido "${salida}"`,
      });
    }
  }
  return { fallas, filas };
}


interface PuntajeGuia {
  caso: CasoGuiaEvaluacion;
  texto: string;
  menciona: boolean;
  faltantes: string[];
  sinProhibido: boolean;
  violaciones: string[];
  sinFence: boolean;
  fence: string | null;
  pasa: boolean;
}

function puntuar(caso: CasoGuiaEvaluacion, texto: string): PuntajeGuia {
  const tn = normalizarMatch(texto);
  const faltantes = caso.debe_mencionar.filter((t) => !tn.includes(normalizarMatch(t)));
  const prohibidos = [...caso.no_debe, ...NO_DEBE_GLOBAL];
  const violaciones = prohibidos.filter((t) => tn.includes(normalizarMatch(t)));
  const fence = tieneFenceCreacion(texto);
  const menciona = faltantes.length === 0;
  const sinProhibido = violaciones.length === 0;
  const sinFence = fence === null;
  return {
    caso,
    texto,
    menciona,
    faltantes,
    sinProhibido,
    violaciones,
    sinFence,
    fence,
    pasa: menciona && sinProhibido && sinFence,
  };
}

// --- Puntuación de desambiguación y seguimiento ---

interface PuntajeBinny {
  caso: CasoBinnyEvaluacion;
  texto: string;
  pasa: boolean;
  detalle: string;
}

function mencionaAlguna(caso: CasoBinnyEvaluacion, textoNorm: string): boolean {
  if (caso.debe_mencionar_alguna.length === 0) return true;
  return caso.debe_mencionar_alguna.some((t) => textoNorm.includes(normalizarMatch(t)));
}

/** Desambiguación: repregunta corta (o respuesta directa) y sin prohibidos. */
function puntuarDesambiguacion(caso: CasoBinnyEvaluacion, texto: string): PuntajeBinny {
  // Se quita SOLO el bloque `seguir`: el resto (incluidos otros fences, como un
  // SQL filtrado) sí cuenta para las prohibiciones y los tecnicismos.
  const principal = quitarBloquesSeguir(texto);
  const tn = normalizarMatch(principal);
  const hayPregunta = /[?¿]/.test(principal);
  const sinRespuesta = tn.trim().length === 0;
  const alguna = mencionaAlguna(caso, tn);
  const faltantes = caso.debe_mencionar.filter((t) => !tn.includes(normalizarMatch(t)));
  const tecnicismos = TERMINOS_TECNICOS_SEGUIR.filter((t) => tn.includes(normalizarMatch(t)));
  const violaciones = [...caso.no_debe, ...NO_DEBE_BINNY_GLOBAL].filter((t) =>
    tn.includes(normalizarMatch(t)),
  );
  const sql = contieneSql(principal);
  const completa = cumpleRespuestaCompleta(texto);
  const repreguntaOk = caso.espera_repregunta ? hayPregunta : !hayPregunta;
  const pasa =
    !sinRespuesta && repreguntaOk && alguna && faltantes.length === 0 &&
    tecnicismos.length === 0 && violaciones.length === 0 && sql === null && completa;
  const detalle = [
    sinRespuesta ? 'sin-respuesta' : '',
    !completa ? 'respuesta-incompleta' : '',
    caso.espera_repregunta
      ? hayPregunta ? 'repregunta:ok' : 'repregunta:falta'
      : hayPregunta ? 'repregunta:inesperada' : 'sin-repregunta:ok',
    !alguna ? 'no-menciona-dato' : '',
    faltantes.length ? `falta: ${faltantes.join(', ')}` : '',
    tecnicismos.length ? `tecnicismo: ${tecnicismos.join(', ')}` : '',
    sql ? `sql-filtrado: ${sql}` : '',
    violaciones.length ? `prohibido: ${violaciones.join(', ')}` : '',
  ].filter(Boolean).join(' | ');
  return { caso, texto, pasa, detalle };
}

/** Seguimiento: bloque ```seguir con 2-3 preguntas cortas, sin tecnicismos, al final. */
function puntuarSeguimiento(caso: CasoBinnyEvaluacion, texto: string): PuntajeBinny {
  const lineas = extraerLineasSeguir(texto);
  const tiene = lineas !== null;
  const cantidad = lineas?.length ?? 0;
  const cantidadOk = tiene && cantidad >= 2 && cantidad <= 3;
  const largoOk = cantidadOk && lineas!.every((l) => l.length <= 60);
  const preguntasOk = cantidadOk && lineas!.every((l) => /[?¿]/.test(l));
  const sinTecnicos =
    cantidadOk &&
    lineas!.every((l) => !TERMINOS_TECNICOS_SEGUIR.some((t) => normalizarMatch(l).includes(normalizarMatch(t))));
  const alFinal = tiene && texto.trim().endsWith('```');
  // El bloque NUNCA reemplaza la respuesta: sin texto principal, es un fallo.
  const conRespuesta = quitarBloquesSeguir(texto).trim().length > 0;
  // El bloque no puede ser exactamente el ejemplo del prompt (anti-repetición).
  const copiaEjemplo =
    tiene && lineas!.every((l) => EJEMPLO_SEGUIR.some((e) => normalizarMatch(l) === normalizarMatch(e)));
  const violaciones = [...caso.no_debe, ...NO_DEBE_BINNY_GLOBAL].filter((t) =>
    normalizarMatch(texto).includes(normalizarMatch(t)),
  );
  const sql = contieneSql(texto);
  const completa = cumpleRespuestaCompleta(texto);
  const pasa =
    tiene && cantidadOk && largoOk && preguntasOk && sinTecnicos && alFinal &&
    conRespuesta && !copiaEjemplo && violaciones.length === 0 && sql === null && completa;
  const detalle = [
    tiene ? `bloque:${cantidad}` : 'sin-bloque',
    !conRespuesta ? 'sin-respuesta' : '',
    !completa ? 'respuesta-incompleta' : '',
    copiaEjemplo ? 'copia-ejemplo' : '',
    tiene && !cantidadOk ? 'cantidad:fuera-de-2-3' : '',
    tiene && cantidadOk && !largoOk ? 'linea:>60' : '',
    tiene && cantidadOk && !preguntasOk ? 'linea:sin-pregunta' : '',
    tiene && cantidadOk && !sinTecnicos ? 'tecnicismo' : '',
    tiene && !alFinal ? 'no-esta-al-final' : '',
    sql ? `sql-filtrado: ${sql}` : '',
    violaciones.length ? `prohibido: ${violaciones.join(', ')}` : '',
  ].filter(Boolean).join(' | ');
  return { caso, texto, pasa, detalle };
}

/**
 * Datos: la respuesta muestra resultados del negocio con títulos legibles y
 * SIN filtrar SQL ni código. Es la red del bug reportado: el modelo no puede
 * responder con el SELECT a la vista.
 */
function puntuarDatos(caso: CasoBinnyEvaluacion, texto: string): PuntajeBinny {
  const principal = quitarBloquesSeguir(texto);
  const tn = normalizarMatch(principal);
  const sinRespuesta = tn.trim().length === 0;
  const sql = contieneSql(principal);
  const alguna = mencionaAlguna(caso, tn);
  const faltantes = caso.debe_mencionar.filter((t) => !tn.includes(normalizarMatch(t)));
  const violaciones = [...caso.no_debe, ...NO_DEBE_BINNY_GLOBAL].filter((t) =>
    tn.includes(normalizarMatch(t)),
  );
  const pasa =
    !sinRespuesta && sql === null && alguna && faltantes.length === 0 &&
    violaciones.length === 0 && cumpleRespuestaCompleta(texto);
  const detalle = [
    sinRespuesta ? 'sin-respuesta' : '',
    !cumpleRespuestaCompleta(texto) ? 'respuesta-incompleta' : '',
    sql ? `sql-filtrado: ${sql}` : 'sin-sql:ok',
    !alguna ? 'no-muestra-datos' : 'datos:ok',
    faltantes.length ? `falta: ${faltantes.join(', ')}` : '',
    violaciones.length ? `prohibido: ${violaciones.join(', ')}` : '',
  ].filter(Boolean).join(' | ');
  return { caso, texto, pasa, detalle };
}

function puntuarBinny(caso: CasoBinnyEvaluacion, texto: string): PuntajeBinny {
  if (caso.tipo === 'seguimiento') return puntuarSeguimiento(caso, texto);
  if (caso.tipo === 'datos') return puntuarDatos(caso, texto);
  return puntuarDesambiguacion(caso, texto);
}

// --- Verificaciones determinísticas de `puntuarSeguimiento` (red de seguridad) ---
//
// El bloque `seguir` NUNCA reemplaza la respuesta (el texto sin el bloque debe
// tener contenido) y no puede ser el ejemplo del prompt (anti-repetición).
// Esta tabla fija ese criterio ANTES de puntuar al modelo.

interface CasoSeguirScoring {
  id: string;
  texto: string;
  espera: 'pasa' | 'falla';
}

const CASO_SEGUIR_SINTETICO: CasoBinnyEvaluacion = {
  id: 'sintetico',
  tipo: 'seguimiento',
  pregunta: '¿Cómo vienen las ventas?',
  debe_mencionar: [],
  debe_mencionar_alguna: [],
  no_debe: [],
};

const CASOS_SEGUIR_SCORING: CasoSeguirScoring[] = [
  {
    id: 'solo_bloque_nuevo',
    texto: '```seguir\n¿Qué producto se vendió más hoy?\n¿Cómo viene la semana?\n```',
    espera: 'falla',
  },
  {
    id: 'solo_bloque_ejemplo',
    texto: '```seguir\n¿Cómo viene la cobranza?\n¿Qué productos tengo sin movimiento?\n¿Cuánto gasté este mes?\n```',
    espera: 'falla',
  },
  {
    id: 'respuesta_con_bloque_nuevo',
    texto: 'Hoy vendiste $45.000 en 12 ventas.\n\n```seguir\n¿Qué producto se vendió más hoy?\n¿Cómo viene la semana?\n```',
    espera: 'pasa',
  },
  {
    id: 'respuesta_con_bloque_ejemplo',
    texto: 'Hoy vendiste $45.000 en 12 ventas.\n\n```seguir\n¿Cómo viene la cobranza?\n¿Qué productos tengo sin movimiento?\n¿Cuánto gasté este mes?\n```',
    espera: 'falla',
  },
];

function verificarSeguirScoring(): { fallas: Falla[]; filas: string[] } {
  const fallas: Falla[] = [];
  const filas: string[] = [];
  for (const caso of CASOS_SEGUIR_SCORING) {
    const p = puntuarSeguimiento(CASO_SEGUIR_SINTETICO, caso.texto);
    const ok = caso.espera === 'pasa' ? p.pasa : !p.pasa;
    filas.push(
      `| ${caso.id.padEnd(30)} | ${caso.espera.padEnd(6)} | ${(p.pasa ? 'pasa' : 'falla').padEnd(6)} | ${ok ? '✓' : '✗'} |`,
    );
    if (!ok) {
      fallas.push({
        check: `seguirScoring:${caso.id}`,
        detalle: `esperado "${caso.espera}" — ${p.detalle}`,
      });
    }
  }
  return { fallas, filas };
}

// --- Verificaciones determinísticas de `puntuarDatos` / `contieneSql` (red anti-SQL) ---
//
// El bug real: Binny respondió con el SELECT de ventas bajo costo a la vista.
// Esta tabla fija el criterio ANTES de puntuar al modelo: una tabla con datos
// legibles pasa; pegar SQL (SELECT … FROM, JOIN o ```sql) falla.

interface CasoSqlScoring {
  id: string;
  texto: string;
  espera: 'pasa' | 'falla';
}

const CASO_DATOS_SINTETICO: CasoBinnyEvaluacion = {
  id: 'sintetico_datos',
  tipo: 'datos',
  pregunta: '¿Vendí productos por debajo de mi costo?',
  debe_mencionar: [],
  debe_mencionar_alguna: ['producto', 'precio', 'costo', 'pérdida'],
  no_debe: [],
};

const CASOS_SQL_SCORING: CasoSqlScoring[] = [
  {
    id: 'tabla_limpia',
    texto: [
      'Sí, vendiste algunos productos por debajo de tu costo:',
      '',
      '| Producto | Precio | Costo | Pérdida |',
      '| --- | --- | --- | --- |',
      '| Gaseosa 2L | $900 | $1.000 | $100 |',
    ].join('\n'),
    espera: 'pasa',
  },
  {
    id: 'sql_select_from',
    texto: 'Perdés en estos:\n\nSELECT p.nombre AS producto, vi.precio_unitario FROM venta_item vi JOIN venta v ON v.id = vi.venta_id',
    espera: 'falla',
  },
  {
    id: 'bloque_sql',
    texto: 'Acá está el detalle:\n\n```sql\nSELECT * FROM venta\n```',
    espera: 'falla',
  },
  {
    id: 'solo_join',
    texto: 'Esto sale de un JOIN de tablas del sistema.',
    espera: 'falla',
  },
];

function verificarSqlScoring(): { fallas: Falla[]; filas: string[] } {
  const fallas: Falla[] = [];
  const filas: string[] = [];
  for (const caso of CASOS_SQL_SCORING) {
    const p = puntuarDatos(CASO_DATOS_SINTETICO, caso.texto);
    const ok = caso.espera === 'pasa' ? p.pasa : !p.pasa;
    filas.push(
      `| ${caso.id.padEnd(30)} | ${caso.espera.padEnd(6)} | ${(p.pasa ? 'pasa' : 'falla').padEnd(6)} | ${ok ? '✓' : '✗'} |`,
    );
    if (!ok) {
      fallas.push({
        check: `sqlScoring:${caso.id}`,
        detalle: `esperado "${caso.espera}" — ${p.detalle}`,
      });
    }
  }
  return { fallas, filas };
}

// --- Verificaciones determinísticas de `cumpleSinDisculpas` / `cumpleSinOfrecerLoPedido` ---
//
// Bug real: ante "¿Qué me conviene reponer primero? Armame una lista para pedirle
// al proveedor", Binny se disculpó ("Tienes razón, disculpá… no debí inventar") y
// OFRECIÓ armar la lista que el comerciante YA había pedido. Esta tabla fija los
// criterios ANTES de puntuar al modelo, incluida la repregunta legítima de
// desambiguación ("¿Querés que te muestre…?"), que NO debe marcarse.

interface CasoDisculpasOfrecimiento {
  id: string;
  texto: string;
  espera: 'pasa' | 'falla';
}

const CASOS_DISCULPAS_OFRECIMIENTO: CasoDisculpasOfrecimiento[] = [
  {
    id: 'respuesta_directa',
    texto: 'Te conviene reponer primero Coca-Cola 1.5L: 24 unidades.',
    espera: 'pasa',
  },
  {
    id: 'disculpa_tenes_razon',
    texto: 'Tienes razón, disculpá. No tenía los datos exactos.',
    espera: 'falla',
  },
  {
    id: 'disculpa_no_debi',
    texto: 'Perdoná, no debí inventar cantidades.',
    espera: 'falla',
  },
  {
    id: 'habla_de_su_turno',
    texto: 'En este turno no tenía la rotación a mano.',
    espera: 'falla',
  },
  {
    id: 'turno_de_caja_no_marca',
    texto: 'No registraste gastos en este turno, así que el efectivo en caja es $0,00.',
    espera: 'pasa',
  },
  {
    id: 'ofrece_lo_pedido',
    texto: '¿Querés que te genere ahora mismo esa lista de reposición?',
    espera: 'falla',
  },
  {
    id: 'ofrece_armar',
    texto: '¿Quieres que te arme la lista para el proveedor?',
    espera: 'falla',
  },
  {
    id: 'desambiguacion_legitima',
    texto: '¿Querés que te muestre de hoy, de la semana o del mes?',
    espera: 'pasa',
  },
];

function verificarDisculpasYOfrecimiento(): { fallas: Falla[]; filas: string[] } {
  const fallas: Falla[] = [];
  const filas: string[] = [];
  for (const caso of CASOS_DISCULPAS_OFRECIMIENTO) {
    const sinDisculpas = cumpleSinDisculpas(caso.texto);
    const sinOfrecer = cumpleSinOfrecerLoPedido(caso.texto);
    const pasa = sinDisculpas && sinOfrecer;
    const ok = caso.espera === 'pasa' ? pasa : !pasa;
    filas.push(
      `| ${caso.id.padEnd(26)} | ${caso.espera.padEnd(6)} | ${(sinDisculpas ? 'ok' : 'disculpa').padEnd(9)} | ${(sinOfrecer ? 'ok' : 'ofrece').padEnd(7)} | ${ok ? '✓' : '✗'} |`,
    );
    if (!ok) {
      fallas.push({
        check: `disculpasOfrecimiento:${caso.id}`,
        detalle: `esperado "${caso.espera}" (sinDisculpas=${sinDisculpas}, sinOfrecerLoPedido=${sinOfrecer})`,
      });
    }
  }
  return { fallas, filas };
}

// --- Modo LLM ---

async function correrLlm(): Promise<{ puntajes: PuntajeGuia[]; nota?: string }> {
  let env: { LLM_API_KEY?: string; LLM_MODEL?: string };
  let llamarLLM: typeof import('../src/features/chat/chat.llm').llamarLLM;
  try {
    env = (await import('../src/config/env')).env;
    ({ llamarLLM } = await import('../src/features/chat/chat.llm'));
  } catch (e) {
    return {
      puntajes: [],
      nota: `No se pudo cargar la configuración del LLM: ${e instanceof Error ? e.message : e}`,
    };
  }

  if (!env.LLM_API_KEY) {
    return { puntajes: [], nota: 'Falta LLM_API_KEY en el .env: se omite el modo LLM.' };
  }

  console.log(`\n[LLM] Modelo: ${env.LLM_MODEL} — evaluando ${CORPUS_GUIA_EVALUACION.length} preguntas...\n`);

  const puntajes: PuntajeGuia[] = [];
  for (const caso of CORPUS_GUIA_EVALUACION) {
    let texto = '';
    try {
      const promptSistema = construirPromptSistema('agente', CONTEXTO, caso.pregunta);
      const { respuesta } = await llamarLLM(
        [
          { role: 'system', content: promptSistema },
          { role: 'user', content: caso.pregunta },
        ],
        { jsonMode: false },
      );
      texto = respuesta.tipo === 'respuesta' ? respuesta.texto : '';
    } catch (e) {
      console.log(`  ✗ ${caso.id}: error del LLM — ${e instanceof Error ? e.message : e}`);
    }
    const p = puntuar(caso, texto);
    puntajes.push(p);
    const detalle = p.pasa ? 'ok' : [
      p.faltantes.length ? `falta: ${p.faltantes.join(', ')}` : '',
      p.violaciones.length ? `prohibido: ${p.violaciones.join(', ')}` : '',
      p.fence ? `fence: ${p.fence}` : '',
    ].filter(Boolean).join(' | ');
    console.log(`  ${p.pasa ? '✓' : '✗'} ${caso.id.padEnd(18)} ${detalle}`);
  }
  return { puntajes };
}

async function correrLlmBinny(): Promise<{ puntajes: PuntajeBinny[]; nota?: string }> {
  let env: { LLM_API_KEY?: string; LLM_MODEL?: string };
  let llamarLLM: typeof import('../src/features/chat/chat.llm').llamarLLM;
  try {
    env = (await import('../src/config/env')).env;
    ({ llamarLLM } = await import('../src/features/chat/chat.llm'));
  } catch (e) {
    return {
      puntajes: [],
      nota: `No se pudo cargar la configuración del LLM: ${e instanceof Error ? e.message : e}`,
    };
  }

  if (!env.LLM_API_KEY) {
    return { puntajes: [], nota: 'Falta LLM_API_KEY en el .env: se omite el modo LLM.' };
  }

  console.log(`\n[LLM] Desambiguación + seguimiento — ${CORPUS_BINNY_EVALUACION.length} preguntas...\n`);

  const puntajes: PuntajeBinny[] = [];
  for (const caso of CORPUS_BINNY_EVALUACION) {
    let texto = '';
    try {
      const promptSistema = construirPromptSistema('agente', CONTEXTO_BINNY, caso.pregunta);
      const { respuesta } = await llamarLLM(
        [
          { role: 'system', content: promptSistema },
          { role: 'user', content: caso.pregunta },
        ],
        { jsonMode: false },
      );
      texto = respuesta.tipo === 'respuesta' ? respuesta.texto : '';
    } catch (e) {
      console.log(`  ✗ ${caso.id}: error del LLM — ${e instanceof Error ? e.message : e}`);
    }
    const p = puntuarBinny(caso, texto);
    puntajes.push(p);
    console.log(`  ${p.pasa ? '✓' : '✗'} ${caso.id.padEnd(22)} ${p.detalle}`);
  }
  return { puntajes };
}

// --- Reporte ---

function escribirReporte(
  puntajes: PuntajeGuia[],
  nota?: string,
  binny?: { puntajes: PuntajeBinny[]; nota?: string },
): void {
  const total = puntajes.length;
  const ok = puntajes.filter((p) => p.pasa).length;
  const lineas: string[] = [
    '# Evaluación del modo guía de Binny (modo LLM)',
    '',
    `Fecha: ${new Date().toISOString()}`,
    '',
    `## Resultado global (guía): ${ok}/${total} (${total ? Math.round((ok / total) * 100) : 0}%)`,
    '',
  ];
  if (nota) lineas.push(`> ${nota}`, '');
  lineas.push('| id | pantalla | menciona | sin prohibido | sin fence | pasa |');
  lineas.push('| --- | --- | :-: | :-: | :-: | :-: |');
  const s = (b: boolean) => (b ? '✓' : '✗');
  for (const p of puntajes) {
    lineas.push(
      `| ${p.caso.id} | ${p.caso.pantalla_esperada} | ${s(p.menciona)} | ${s(p.sinProhibido)} | ${s(p.sinFence)} | ${s(p.pasa)} |`,
    );
  }
  lineas.push('', '## Respuestas', '');
  for (const p of puntajes) {
    lineas.push(`### ${p.caso.id} — ${p.caso.pregunta}`, '');
    if (p.faltantes.length) lineas.push(`- Faltó mencionar: ${p.faltantes.join(', ')}`);
    if (p.violaciones.length) lineas.push(`- Dijo lo prohibido: ${p.violaciones.join(', ')}`);
    if (p.fence) lineas.push(`- Emitió fence de creación: ${p.fence}`);
    lineas.push('', '```text', p.texto || '(sin respuesta)', '```', '');
  }

  if (binny) {
    const bt = binny.puntajes.length;
    const bok = binny.puntajes.filter((p) => p.pasa).length;
    lineas.push(
      '',
      '# Desambiguación + seguimiento (modo LLM)',
      '',
      `## Resultado global: ${bok}/${bt} (${bt ? Math.round((bok / bt) * 100) : 0}%)`,
      '',
    );
    if (binny.nota) lineas.push(`> ${binny.nota}`, '');
    lineas.push('| id | tipo | pasa | detalle |');
    lineas.push('| --- | --- | :-: | --- |');
    for (const p of binny.puntajes) {
      lineas.push(`| ${p.caso.id} | ${p.caso.tipo} | ${p.pasa ? '✓' : '✗'} | ${p.detalle} |`);
    }
    lineas.push('', '## Respuestas', '');
    for (const p of binny.puntajes) {
      lineas.push(`### ${p.caso.id} — ${p.caso.pregunta}`, '');
      lineas.push(`- ${p.detalle}`);
      lineas.push('', '```text', p.texto || '(sin respuesta)', '```', '');
    }
  }

  fs.mkdirSync(path.dirname(RUTA_REPORTE), { recursive: true });
  fs.writeFileSync(RUTA_REPORTE, lineas.join('\n'), 'utf8');
}

// --- Main ---

async function main() {
  console.log('=== Evaluación del modo guía de Binny ===');
  console.log(`Corpus guía: ${CORPUS_GUIA_EVALUACION.length} preguntas "¿cómo…?"`);
  console.log(`Corpus desambiguación + seguimiento + datos: ${CORPUS_BINNY_EVALUACION.length} preguntas\n`);

  const norm = verificarNormalizarSeguir();
  const nombres = verificarQuitarNombresInternos();
  const seguir = verificarSeguirScoring();
  const sql = verificarSqlScoring();
  const disculpas = verificarDisculpasYOfrecimiento();
  const fallas = [
    ...verificarDeterministico(),
    ...verificarBinnyDeterministico(),
    ...norm.fallas,
    ...nombres.fallas,
    ...seguir.fallas,
    ...sql.fallas,
    ...disculpas.fallas,
  ];

  console.log('--- normalizarSeguir: tabla de casos (red determinística) ---');
  console.log('| caso                           | espera   | bloque    | salida     | ok |');
  console.log('| ------------------------------ | -------- | --------- | ---------- | -- |');
  for (const fila of norm.filas) console.log(fila);
  console.log('');
  console.log('--- quitarNombresInternos: tabla de casos (barrera anti-nombres internos) ---');
  console.log('| caso                   | espera                                     | salida                                     | ok |');
  console.log('| ---------------------- | ------------------------------------------ | ------------------------------------------ | -- |');
  for (const fila of nombres.filas) console.log(fila);
  console.log('');
  console.log('--- puntuarSeguimiento: tabla de casos (red determinística) ---');
  console.log('| caso                           | espera | salida | ok |');
  console.log('| ------------------------------ | ------ | ------ | -- |');
  for (const fila of seguir.filas) console.log(fila);
  console.log('');
  console.log('--- puntuarDatos / contieneSql: tabla de casos (red anti-SQL) ---');
  console.log('| caso                           | espera | salida | ok |');
  console.log('| ------------------------------ | ------ | ------ | -- |');
  for (const fila of sql.filas) console.log(fila);
  console.log('');
  console.log('--- cumpleSinDisculpas / cumpleSinOfrecerLoPedido: tabla de casos (red anti-disculpa) ---');
  console.log('| caso                       | espera | disculpa  | ofrece  | ok |');
  console.log('| -------------------------- | ------ | --------- | ------- | -- |');
  for (const fila of disculpas.filas) console.log(fila);
  console.log('');

  if (fallas.length === 0) {
    console.log('✓ Determinístico: recuperación + prompt (sin bloques) + seguir/desambiguación + normalizarSeguir + quitarNombresInternos + puntuarSeguimiento + contieneSql + disculpas/ofrecimiento OK');
    for (const modo of MODOS) {
      const p = construirPromptSistema(modo, CONTEXTO, CORPUS_GUIA_EVALUACION[0].pregunta);
      console.log(`  prompt[${modo}] = ${p.length} chars`);
    }
    console.log(`  FENCES_AUTORIZADOS = ${FENCES_AUTORIZADOS.join(', ')}`);
  } else {
    console.log(`✗ Determinístico: ${fallas.length} problema(s)`);
    for (const f of fallas) console.log(`  - [${f.check}] ${f.detalle}`);
  }

  if (!MODO_LLM) {
    console.log('\n(modo determinístico; usá --llm para puntuar al modelo real)');
    process.exit(fallas.length === 0 ? 0 : 1);
  }

  const guia = await correrLlm();
  const binny = await correrLlmBinny();
  escribirReporte(guia.puntajes, guia.nota, binny);
  if (guia.nota) {
    console.log(`\n${guia.nota}`);
    console.log(`Reporte escrito en ${RUTA_REPORTE}`);
    process.exit(fallas.length === 0 ? 0 : 1);
  }

  const s = (b: boolean) => (b ? '✓' : '✗');

  const total = guia.puntajes.length;
  const ok = guia.puntajes.filter((p) => p.pasa).length;
  console.log('\n--- Scoreboard guía ---');
  for (const p of guia.puntajes) {
    console.log(
      `${p.pasa ? '✓' : '✗'} ${p.caso.id.padEnd(18)} menciona:${s(p.menciona)}` +
      ` prohibido:${s(p.sinProhibido)} fence:${s(p.sinFence)}`,
    );
  }
  console.log(`\nGLOBAL guía: ${ok}/${total} (${total ? Math.round((ok / total) * 100) : 0}%)`);

  const btotal = binny.puntajes.length;
  const bok = binny.puntajes.filter((p) => p.pasa).length;
  console.log('\n--- Scoreboard desambiguación + seguimiento + datos ---');
  for (const p of binny.puntajes) {
    console.log(`${p.pasa ? '✓' : '✗'} ${p.caso.id.padEnd(22)} ${p.detalle}`);
  }
  console.log(`\nGLOBAL desambiguación + seguimiento + datos: ${bok}/${btotal} (${btotal ? Math.round((bok / btotal) * 100) : 0}%)`);
  console.log(`Reporte escrito en ${RUTA_REPORTE}`);

  // El código de salida lo gobierna el determinístico (la varianza del modelo
  // no debe volver flaky la suite); el scoreboard LLM es informativo.
  process.exit(fallas.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ Evaluación falló inesperadamente — ${e instanceof Error ? e.stack ?? e.message : e}`);
  process.exit(1);
});
