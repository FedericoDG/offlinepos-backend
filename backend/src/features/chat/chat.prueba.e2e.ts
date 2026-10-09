/**
 * Corpus de prueba end-to-end de Binny (modo agente).
 *
 * A diferencia de `chat.evaluacion.ts` (que puntúa el SQL generado) y de
 * `chat.binny.evaluacion.ts` (que puntúa desambiguación/seguimiento), este
 * corpus mide el RESULTADO FINAL que ve el comerciante a través del flujo real
 * del agente: prompt de sistema + function calling + ejecución de la consulta
 * contra una copia de la base.
 *
 * Cada caso declara qué exige la respuesta final, además de las cuatro reglas
 * comunes a TODOS los casos (SQL oculto, sin tecnicismos, con respuesta útil y
 * sugerencias envueltas en ```seguir).
 *
 * El ejecutor es `scripts/prueba-binny-e2e.mts`. Las funciones de evaluación de
 * acá son PURAS (sin red, sin DB) para poder testearlas y reusarlas.
 */

export type TipoPruebaE2E = 'datos' | 'ambigua' | 'guia' | 'anti-creacion' | 'variada';

/** Reglas que este caso exige además de las cuatro comunes a todos. */
export interface ExigenciasE2E {
  /** No debe filtrar SQL/código (SELECT…FROM, JOIN, ```sql). */
  sinSql?: boolean;
  /** El texto útil (sin bloques) debe tener contenido real. */
  tieneRespuesta?: boolean;
  /** Sin nombres internos de la base ("SQL", "SELECT", "JOIN", "FROM", "base de datos", "vista_", "unixepoch", "strftime" o guion_bajo). "tabla"/"columna" solo se marcan fuera del contexto de tabla de resultados / planilla de Excel. */
  sinTerminosTecnicos?: boolean;
  /** Debe incluir al menos un número (idealmente un monto). */
  conNumero?: boolean;
  /** Debe ser una repregunta corta de desambiguación. */
  repregunta?: boolean;
  /** Debe guiar con camino de menú + al menos 2 pasos numerados. */
  guiaConPasos?: boolean;
  /** Debe negarse explícitamente a crear/modificar datos del negocio. */
  seNiega?: boolean;
  /** Si hay 2-4 preguntas sueltas al final, deben ir dentro de ```seguir. */
  sugerenciasEnvueltas?: boolean;
}

export interface CasoPruebaE2E {
  /** Identificador estable y único. */
  id: string;
  /** Pregunta del comerciante, textual. */
  pregunta: string;
  /** Familia de comportamiento, para reportar tasa por tipo. */
  tipo: TipoPruebaE2E;
  /** Qué exige este caso (además de las 4 comunes). */
  exige: ExigenciasE2E;
  /** Nota opcional: por qué está en el corpus (bug que lo motivó). */
  nota?: string;
}

// --- Reglas comunes a TODOS los casos ---
// El caso puede reforzarlas con `exige`, pero nunca relajarlas.
export const EXIGENCIAS_COMUNES: Required<
  Pick<ExigenciasE2E, 'sinSql' | 'sinTerminosTecnicos' | 'tieneRespuesta' | 'sugerenciasEnvueltas'>
> = {
  sinSql: true,
  sinTerminosTecnicos: true,
  tieneRespuesta: true,
  sugerenciasEnvueltas: true,
};

export const CORPUS_PRUEBA_E2E: CasoPruebaE2E[] = [
  // ---------------------------------------------------------------- Datos
  {
    id: 'datos-vendi-hoy',
    pregunta: '¿Cuánto vendí hoy?',
    tipo: 'datos',
    exige: { conNumero: true },
  },
  {
    id: 'datos-vendi-mes',
    pregunta: '¿Cuánto vendí este mes?',
    tipo: 'datos',
    exige: { conNumero: true },
  },
  {
    id: 'datos-gaste-mes',
    pregunta: '¿Cuánto gasté este mes?',
    tipo: 'datos',
    exige: { conNumero: true },
  },
  {
    id: 'datos-top5-productos',
    pregunta: '¿Cuáles fueron mis 5 productos más vendidos?',
    tipo: 'datos',
    exige: { conNumero: true },
    nota: 'Falló: no traía el ranking real.',
  },
  {
    id: 'datos-comparacion-mes-pasado',
    pregunta: '¿Cómo viene la comparación con el mes pasado?',
    tipo: 'datos',
    exige: { conNumero: true },
    nota: 'Falló: comparación sin números.',
  },
  {
    id: 'datos-bajo-costo',
    pregunta: '¿Qué productos vendo por debajo del costo?',
    tipo: 'datos',
    exige: { conNumero: true },
    nota: 'Falló: filtró el SELECT a la vista.',
  },
  {
    id: 'datos-quien-me-debe',
    pregunta: '¿Quién me debe plata?',
    tipo: 'datos',
    exige: { conNumero: true },
  },
  {
    id: 'datos-sin-movimiento',
    pregunta: '¿Qué productos tengo sin movimiento?',
    tipo: 'datos',
    exige: { conNumero: true },
  },
  {
    id: 'datos-cobranza',
    pregunta: '¿Cómo viene la cobranza?',
    tipo: 'datos',
    exige: { conNumero: true },
  },
  {
    id: 'datos-cantidad-productos',
    pregunta: '¿Cuántos productos tengo?',
    tipo: 'datos',
    exige: { conNumero: true },
  },

  // ------------------------------------------------------------- Ambiguas
  {
    id: 'amb-vendi',
    pregunta: '¿Cuánto vendí?',
    tipo: 'ambigua',
    exige: { repregunta: true },
  },
  {
    id: 'amb-gaste',
    pregunta: '¿Cuánto gasté?',
    tipo: 'ambigua',
    exige: { repregunta: true },
  },
  {
    id: 'amb-como-vienen-ventas',
    pregunta: '¿Cómo vienen las ventas?',
    tipo: 'ambigua',
    exige: { repregunta: true },
  },

  // ---------------------------------------------------------------- Guías
  {
    id: 'guia-combo',
    pregunta: '¿Cómo creo un combo?',
    tipo: 'guia',
    exige: { guiaConPasos: true },
  },
  {
    id: 'guia-compra',
    pregunta: '¿Cómo cargo una compra?',
    tipo: 'guia',
    exige: { guiaConPasos: true },
  },
  {
    id: 'guia-iva',
    pregunta: '¿Cómo habilito el IVA?',
    tipo: 'guia',
    exige: { guiaConPasos: true },
  },
  {
    id: 'guia-cierre-caja',
    pregunta: '¿Cómo hago el cierre de caja?',
    tipo: 'guia',
    exige: { guiaConPasos: true },
  },
  {
    id: 'guia-alta-cliente',
    pregunta: '¿Cómo doy de alta un cliente?',
    tipo: 'guia',
    exige: { guiaConPasos: true },
  },
  {
    id: 'guia-importar-excel',
    pregunta: '¿Cómo importo el catálogo desde Excel?',
    tipo: 'guia',
    exige: { guiaConPasos: true },
  },

  // -------------------------------------------------------- Anti-creación
  {
    id: 'anti-producto',
    pregunta: 'Creame un producto que se llame Prueba, costo 100 venta 200',
    tipo: 'anti-creacion',
    exige: { seNiega: true, tieneRespuesta: true },
  },
  {
    id: 'anti-gasto',
    pregunta: 'Cargame un gasto de 5000 de luz',
    tipo: 'anti-creacion',
    exige: { seNiega: true, tieneRespuesta: true },
  },
  {
    id: 'anti-modulo',
    pregunta: 'Activame el módulo de combos vos',
    tipo: 'anti-creacion',
    exige: { seNiega: true, tieneRespuesta: true },
  },

  // --------------------------------------------------------------- Varias
  {
    id: 'var-precios-costos',
    pregunta: '¿Qué productos tienen mal el precio de venta o el costo?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-stock-bajo',
    pregunta: '¿Qué productos tengo con stock bajo?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-vencimientos',
    pregunta: '¿Qué productos están por vencer?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-clientes-inactivos',
    pregunta: '¿Qué clientes no me compran hace tiempo?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-gastos-programados',
    pregunta: '¿Qué pagos se me vienen esta semana?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-medios-pago',
    pregunta: '¿Cómo se cobró hoy? Quiero el total por cada forma de pago',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-reponer',
    pregunta: '¿Qué me conviene reponer?',
    tipo: 'variada',
    exige: {},
  },
  {
    id: 'var-anomalias',
    pregunta: '¿Hubo algo raro en las ventas últimamente?',
    tipo: 'variada',
    exige: {},
  },
  {
    id: 'var-balance',
    pregunta: '¿Cuál es mi balance de este mes?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-ticket-promedio',
    pregunta: '¿Cuál es mi ticket promedio de este mes?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-mejores-clientes',
    pregunta: '¿Quiénes son mis mejores clientes?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-margen',
    pregunta: '¿Cuánto margen me dejaron las ventas de este mes?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-fugas-precio',
    pregunta: '¿Vendí productos por debajo de mi costo?',
    tipo: 'variada',
    exige: {},
  },
  {
    id: 'var-abc',
    pregunta: '¿Qué productos mantienen mi negocio?',
    tipo: 'variada',
    exige: {},
  },
  {
    id: 'var-cajeros',
    pregunta: '¿Cómo se desempeñaron mis cajeros?',
    tipo: 'variada',
    exige: {},
  },
  {
    id: 'var-ventas-por-dia',
    pregunta: '¿Cómo se movieron las ventas día por día esta semana?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-proveedores',
    pregunta: '¿Cuánto le compré a cada proveedor este mes?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
  {
    id: 'var-caja',
    pregunta: '¿Cuánta plata tengo en caja ahora?',
    tipo: 'variada',
    exige: { conNumero: true },
  },
];

// ============================================================================
// Evaluación determinística (funciones puras)
// ============================================================================

export interface ResultadoCasoE2E {
  id: string;
  ok: boolean;
  /** Nombres de los checks que fallaron (vacío si pasó). */
  fallas: string[];
  /** Etiquetas legibles de las fallas, para el reporte. */
  detalle: string;
}

/** Quita los bloques de código con fence (```lang … ```), incluido ```seguir. */
export function quitarBloquesDeCodigo(texto: string): string {
  return (texto ?? '').replace(/```[\s\S]*?```/g, ' ');
}

/** Quita SOLO el bloque ```seguir (para evaluar el texto principal). */
export function quitarBloqueSeguir(texto: string): string {
  return (texto ?? '').replace(/```seguir[\s\S]*?```/gi, ' ');
}

function normalizar(texto: string): string {
  return (texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const RE_SQL_FENCE = /```\s*sql\b/i;
const RE_SELECT_FROM = /\bselect\b[\s\S]{0,500}?\bfrom\b/i;
const RE_JOIN = /\bjoin\b/i;

/** Patrones de SQL/código filtrado presentes en el texto (vacío = limpio). */
export function detectarSql(texto: string): string[] {
  const t = texto ?? '';
  const hallados: string[] = [];
  if (RE_SQL_FENCE.test(t)) hallados.push('bloque ```sql');
  if (RE_SELECT_FROM.test(t)) hallados.push('SELECT … FROM');
  if (RE_JOIN.test(t)) hallados.push('JOIN');
  return hallados;
}

/** `sinSql`: sin SELECT…FROM, sin JOIN y sin bloque ```sql. */
export function cumpleSinSql(texto: string): boolean {
  return detectarSql(texto).length === 0;
}

const TERMINOS_BASE: RegExp[] = [
  /\bsql\b/i,
  /\bselect\b/i,
  /\bjoin\b/i,
  /\bfrom\b/i,
  /\bbase de datos\b/i,
  /\bvista_/i,
  /\bunixepoch\b/i,
  /\bstrftime\b/i,
];
const RE_NOMBRE_CON_GUION_BAJO = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/i;

// "tabla"/"columna" son legítimos al hablar de la TABLA DE RESULTADOS que se le
// muestra al comerciante o de la PLANILLA DE EXCEL (importar/exportar). Solo se
// marcan cuando aparecen FUERA de ese contexto (o sea, como internos de la base).
const RE_TABLA = /\btablas?\b/gi;
const RE_COLUMNA = /\bcolumnas?\b/gi;
const CONTEXTO_TABLA_PERMITIDO =
  /(resultado|excel|planilla|hoja de c[aá]lculo|csv|import|export|archivo|plantilla|t[ií]tulo|cabecera|encabezado|producto|vence|cantidad|precio|costo|total|cliente|monto|stock|saldo|deuda|unidad|ranking|lista|detalle)/i;
// Si el texto trae una tabla Markdown, está mostrando resultados: allí "tabla"/
// "columna" son palabras de comerciante.
const TIENE_TABLA_MARKDOWN = /\n\s*\|[^\n]*\|/;

/** Devuelve la primera aparición de `tabla`/`columna` fuera del contexto permitido. */
function palabraFueraDeContexto(texto: string, re: RegExp): string | null {
  const hayTabla = TIENE_TABLA_MARKDOWN.test(texto);
  for (const m of texto.matchAll(re)) {
    if (hayTabla) continue;
    const idx = m.index ?? 0;
    const inicio = Math.max(0, idx - 60);
    const fin = Math.min(texto.length, idx + m[0].length + 60);
    if (!CONTEXTO_TABLA_PERMITIDO.test(texto.slice(inicio, fin))) return m[0];
  }
  return null;
}

/** Términos técnicos presentes en el texto (vacío = limpio). */
export function terminosTecnicosDetectados(texto: string): string[] {
  // Los bloques autorizados (chart/seguir) se renderizan aparte: no cuentan
  // como texto que el comerciante lee como prosa.
  const t = quitarBloquesDeCodigo(texto ?? '');
  const hallados: string[] = [];
  for (const re of TERMINOS_BASE) {
    const m = re.exec(t);
    if (m) hallados.push(m[0]);
  }
  const tabla = palabraFueraDeContexto(t, RE_TABLA);
  if (tabla) hallados.push(tabla);
  const columna = palabraFueraDeContexto(t, RE_COLUMNA);
  if (columna) hallados.push(columna);
  const guion = RE_NOMBRE_CON_GUION_BAJO.exec(t);
  if (guion) hallados.push(guion[0]);
  return [...new Set(hallados)];
}

/** `sinTerminosTecnicos`: sin jerga ni nombres internos con guion bajo. */
export function cumpleSinTerminosTecnicos(texto: string): boolean {
  return terminosTecnicosDetectados(texto).length === 0;
}

/** `tieneRespuesta`: el texto útil (sin bloques de código ni ```seguir) es real. */
export function cumpleTieneRespuesta(texto: string): boolean {
  const util = quitarBloquesDeCodigo(texto ?? '').replace(/\s+/g, ' ').trim();
  return util.length >= 25;
}

/** `conNumero`: contiene al menos un número (idealmente un monto). */
export function cumpleConNumero(texto: string): boolean {
  const t = quitarBloquesDeCodigo(texto ?? '');
  return /\d/.test(t);
}

/**
 * `repregunta`: el texto es corto (≤220 chars) y termina en pregunta o menciona
 * un período de aclaración explícito (hoy/semana/mes).
 */
export function cumpleRepregunta(texto: string): boolean {
  const t = quitarBloquesDeCodigo(texto ?? '').trim();
  if (t.length === 0 || t.length > 220) return false;
  if (t.endsWith('?')) return true;
  return /(hoy|semana|mes|ayer|per[ií]odo|rango|desde|hasta)/i.test(t);
}

/** `guiaConPasos`: camino de menú (→ o "Menú") + al menos 2 pasos numerados. */
export function cumpleGuiaConPasos(texto: string): boolean {
  const t = quitarBloqueSeguir(texto ?? '');
  const normalizado = normalizar(t);
  const camino = t.includes('→') || /\bmenu\b/.test(normalizado);
  const pasos = (t.match(/(?:^|\n|\s)\d+[.)]\s+/g) ?? []).length;
  return camino && pasos >= 2;
}

const NEGATIVAS = [
  'no puedo',
  'no pude',
  'no puedo crear',
  'no puedo crearlo',
  'no puedo cargar',
  'no puedo activar',
  'no puedo modificar',
  'no puedo hacerlo',
  'no lo puedo hacer',
  'no esta disponible',
  'no esta permitido',
  'no es posible',
  'no me es posible',
  'no tengo permitido',
  'no tengo esa funcion',
  'no tengo herramientas para',
  'eso lo haces vos',
  'eso lo debes hacer',
  'eso lo debe hacer',
  'no creo ni modifico',
  'no realizo',
  'no me encargo',
  'manualmente',
  'lo tenes que hacer vos',
  'lo tenes que hacer',
  'tenes que hacerlo',
  'lo haces vos',
  'lo debe hacer',
];

/** `seNiega`: contiene una negativa explícita a crear/modificar datos. */
export function cumpleSeNiega(texto: string): boolean {
  const n = normalizar(quitarBloquesDeCodigo(texto ?? ''));
  return NEGATIVAS.some((f) => n.includes(f));
}

/**
 * `sugerenciasEnvueltas`: si hay 2-4 líneas-pregunta sueltas al final, DEBEN ir
 * dentro de un bloque ```seguir. Si ya hay bloque seguir (o no hay sufijo de
 * preguntas sueltas), pasa.
 */
export function cumpleSugerenciasEnvueltas(texto: string): boolean {
  const t = texto ?? '';
  if (/```seguir\b/i.test(t)) return true;
  const sinCola = t.replace(/\s+$/, '');
  const lineas = sinCola.split(/\r?\n/);
  let i = lineas.length;
  while (i > 0) {
    const l = lineas[i - 1].trim();
    const esPregunta = l.length > 0 && l.length <= 80 && (l.startsWith('¿') || l.endsWith('?'));
    if (!esPregunta) break;
    i--;
  }
  const cantidad = lineas.length - i;
  return cantidad < 2 || cantidad > 4;
}

/**
 * Corre TODOS los checks del caso (las 4 reglas comunes + las exigencias).
 * PURA: no toca red ni base de datos. Devuelve ok + fallas.
 */
export function evaluarCasoE2E(texto: string, caso: CasoPruebaE2E): ResultadoCasoE2E {
  const exige: ExigenciasE2E = { ...EXIGENCIAS_COMUNES, ...caso.exige };
  const fallas: string[] = [];

  if (exige.sinSql && !cumpleSinSql(texto)) fallas.push(`filtró SQL/código (${detectarSql(texto).join(', ') || 'sql'})`);
  if (exige.sinTerminosTecnicos && !cumpleSinTerminosTecnicos(texto))
    fallas.push(`usó tecnicismos (${terminosTecnicosDetectados(texto).join(', ') || 'término técnico'})`);
  if (exige.tieneRespuesta && !cumpleTieneRespuesta(texto)) fallas.push('sin respuesta útil');
  if (exige.sugerenciasEnvueltas && !cumpleSugerenciasEnvueltas(texto)) fallas.push('sugerencias sueltas (fuera de ```seguir)');
  if (exige.conNumero && !cumpleConNumero(texto)) fallas.push('sin ningún número');
  if (exige.repregunta && !cumpleRepregunta(texto)) fallas.push('no repreguntó (o repreguntó mal)');
  if (exige.guiaConPasos && !cumpleGuiaConPasos(texto)) fallas.push('sin camino de menú/pasos numerados');
  if (exige.seNiega && !cumpleSeNiega(texto)) fallas.push('no se negó explícitamente a crear/modificar');

  return {
    id: caso.id,
    ok: fallas.length === 0,
    fallas,
    detalle: fallas.join('; '),
  };
}
