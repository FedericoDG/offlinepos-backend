/**
 * Corpus de prueba end-to-end de Binny (modo agente).
 *
 * A diferencia de `chat.evaluacion.ts` (que puntúa el SQL generado) y de
 * `chat.binny.evaluacion.ts` (que puntúa desambiguación/seguimiento), este
 * corpus mide el RESULTADO FINAL que ve el comerciante a través del flujo real
 * del agente: prompt de sistema + function calling + ejecución de la consulta
 * contra una copia de la base.
 *
 * Cada caso declara qué exige la respuesta final, además de las siete reglas
 * comunes a TODOS los casos (SQL oculto, sin tecnicismos, con respuesta útil,
 * sugerencias envueltas en ```seguir, respuesta completa sin anuncios, sin
 * disculpas ni auto-referencias y sin ofrecer hacer lo que ya se pidió).
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
  /**
   * El texto útil (sin bloques de código ni ```seguir) NO debe ser un anuncio
   * sin contenido: prohibido cerrar con `:`, con un título suelto o con una
   * lista anunciada que nunca se escribe. Misma semántica que la guarda del
   * desktop (bug real: respuesta cortada que termina en dos puntos).
   */
  respuestaCompleta?: boolean;
  /**
   * El texto NO debe disculparse ni hablar de su propio proceso o de respuestas
   * anteriores ("tenés razón", "disculpá", "no debí", "en este turno", …).
   * Bug real: Binny abrió con "Tienes razón, disculpá. No tenía los datos…".
   */
  sinDisculpas?: boolean;
  /**
   * El texto NO debe OFRECER hacer algo que el comerciante YA pidió (ej: "¿querés
   * que te arme la lista?"). NO incluye la repregunta legítima de desambiguación
   * ("¿Querés que te muestre de hoy, de la semana o del mes?").
   */
  sinOfrecerLoPedido?: boolean;
  /**
   * La respuesta, cuando YA tiene contenido (una tabla de resultados o ≥120
   * caracteres), NO debe TERMINAR con una pregunta de oferta ("¿querés que…?",
   * "¿querés ver…?", "¿te gustaría…?", "¿te armo…?"). El sistema ya le ofrece
   * opciones de seguimiento al comerciante. La repregunta corta de
   * desambiguación queda exceptuada. Bug real: Binny cierra un análisis con
   * "¿Querés que te arme algo más?".
   */
  sinOfertaFinal?: boolean;
  /**
   * Al menos UNA de estas frases (case/acento-insensible) debe aparecer en la
   * respuesta. Se usa para probar que el modelo REUTILIZÓ datos de un turno
   * anterior (ej: la tabla que él mismo mostró) en vez de cambiar de tema.
   */
  debeMencionarAlguna?: string[];
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
  /**
   * Historial OPCIONAL de turnos previos que el ejecutor incluye ANTES de la
   * pregunta del caso, para probar referencias a la respuesta anterior
   * ("esos datos", "esa tabla"). Si se omite, el caso corre igual que siempre
   * (retrocompatible).
   */
  historial?: MensajeHistorialE2E[];
  /** Nota opcional: por qué está en el corpus (bug que lo motivó). */
  nota?: string;
}

/** Un turno previo de la conversación (rol + contenido textual). */
export interface MensajeHistorialE2E {
  rol: 'usuario' | 'asistente';
  contenido: string;
}

// --- Reglas comunes a TODOS los casos ---
// El caso puede reforzarlas con `exige`, pero nunca relajarlas.
export const EXIGENCIAS_COMUNES: Required<
  Pick<
    ExigenciasE2E,
    | 'sinSql'
    | 'sinTerminosTecnicos'
    | 'tieneRespuesta'
    | 'sugerenciasEnvueltas'
    | 'respuestaCompleta'
    | 'sinDisculpas'
    | 'sinOfrecerLoPedido'
    | 'sinOfertaFinal'
  >
> = {
  sinSql: true,
  sinTerminosTecnicos: true,
  tieneRespuesta: true,
  sugerenciasEnvueltas: true,
  respuestaCompleta: true,
  sinDisculpas: true,
  sinOfrecerLoPedido: true,
  sinOfertaFinal: true,
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
    id: 'var-alertas-hoy',
    pregunta: '¿Qué alertas importantes tengo que atender hoy?',
    tipo: 'variada',
    exige: { conNumero: true },
    nota: 'Bug real: la respuesta quedó cortada anunciando alertas sin mostrarlas (terminó en dos puntos).',
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
    id: 'var-reponer-lista',
    pregunta: '¿Qué me conviene reponer primero? Armame una lista para pedirle al proveedor',
    tipo: 'variada',
    exige: { conNumero: true, tieneRespuesta: true },
    nota: 'Bug real: Binny se disculpó ("Tienes razón, disculpá… no debí inventar") y ofreció armar la lista que el comerciante YA había pedido, en vez de hacerla.',
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

  // -------------------------------------------- Referencias y cierre
  {
    id: 'ref-esos-datos',
    pregunta: 'con esos datos puedes armarme un mensaje de whatsapp?',
    tipo: 'variada',
    historial: [
      { rol: 'usuario', contenido: '¿Qué productos me dejaron más ganancia este mes?' },
      {
        rol: 'asistente',
        contenido:
          'Estos son tus 3 productos con más ganancia este mes:\n\n' +
          '| Producto | Ganancia |\n' +
          '| --- | --- |\n' +
          '| Fernet Branca 1L | $60.000 |\n' +
          "| Gin Gordon's | $27.000 |\n" +
          '| Alfajor Fulbito | $25.600 |\n\n' +
          'El Fernet Branca 1L fue tu producto estrella, seguido por el Gin Gordon\'s y el Alfajor Fulbito.',
      },
    ],
    exige: {
      // Al menos uno de estos productos/montos debe aparecer: prueba que Binny
      // reutilizó la tabla que él mismo mostró y no volvió a consultar ni cambió de tema.
      debeMencionarAlguna: [
        'fernet',
        'gordon',
        'fulbito',
        '60.000',
        '60000',
        '27.000',
        '27000',
        '25.600',
        '25600',
      ],
      sinOfrecerLoPedido: true,
    },
    nota: 'Bug real: con la tabla de ganancias en el historial, ante "con esos datos… whatsapp" Binny respondió un resumen de ventas totales en vez de armar el mensaje con esos productos.',
  },
  {
    id: 'sin-oferta-final',
    pregunta: '¿Cuáles fueron mis 5 productos más vendidos este mes?',
    tipo: 'datos',
    exige: { conNumero: true, sinOfertaFinal: true },
    nota: 'Bug real: Binny cerraba análisis con contenido con "¿Querés que te arme algo más?" en vez de terminar con el dato.',
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
  // Los bloques ```whatsapp / ```mensaje SON la respuesta al comerciante (se
  // muestran como mensaje): su contenido cuenta como texto útil. Los demás
  // bloques (chart/seguir/sql) se descartan.
  const conMensajes = (texto ?? '').replace(
    /```(?:whatsapp|mensaje)\b([\s\S]*?)```/gi,
    (_m, cuerpo: string) => ` ${cuerpo} `,
  );
  const util = quitarBloquesDeCodigo(conMensajes).replace(/\s+/g, ' ').trim();
  return util.length >= 25;
}

/** `conNumero`: contiene al menos un número (idealmente un monto). */
export function cumpleConNumero(texto: string): boolean {
  const t = quitarBloquesDeCodigo(texto ?? '');
  return /\d/.test(t);
}

/**
 * `respuestaCompleta`: el texto útil (sin bloques de código ni ```seguir) NO
 * debe ser un ANUNCIO sin contenido. Misma semántica que la guarda del desktop:
 * prohibido cerrar con dos puntos, con un título suelto o con una lista
 * anunciada que nunca se escribe. Bug real: la respuesta quedó cortada en
 * "### 1. Las 2 alertas críticas de hoy\n\nConsulté ... para confirmar:".
 */
export function cumpleRespuestaCompleta(texto: string): boolean {
  const util = quitarBloquesDeCodigo(texto ?? '').replace(/[ \t]+\n/g, '\n').trim();
  // El vacío lo cubre `tieneRespuesta`; acá solo se juzga la forma del cierre.
  if (util.length === 0) return true;
  // Cierre con dos puntos: anuncia algo que nunca se escribe.
  if (/[:：]\s*$/.test(util)) return false;
  const lineas = util.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const ultima = lineas[lineas.length - 1] ?? '';
  // Título suelto al final (heading sin cuerpo debajo).
  if (/^#{1,6}\s+\S/.test(ultima)) return false;
  // Marcador de lista suelto ("1.", "2)", "-", "•") sin ítem escrito.
  if (/^(?:\d+[.)]|[-*•])$/.test(ultima)) return false;
  // Frase de anuncio que promete enumerar y no enumera ni trae cifras.
  if (
    /^(?:estos son|estas son|aqu[ií] (?:est[aá]n|van|ten[eé]s)|a continuaci[oó]n|te (?:muestro|detallo|listo|cuento)|los siguientes|las siguientes|el detalle)\b/i.test(ultima) &&
    !/[\d$]/.test(ultima)
  ) {
    return false;
  }
  return true;
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

// --- Sin disculpas ni auto-referencias (bug real) ---
// Binny abrió con "Tienes razón, disculpá. No tenía los datos exactos… no debí
// inventar cantidades": habló de sí mismo y de respuestas anteriores en lugar de
// dar el dato. Estas frases se buscan sin acentos y case-insensitive.

const FRASES_DISCULPA = [
  'tenes razon',
  'disculp',
  'perdon',
  'me equivoque',
  'no debi',
  'mi error',
];

// "en este turno" es AMBIGUO en un POS: "turno" también es el turno de caja.
// Solo cuenta como auto-referencia al proceso cuando NO está en un contexto de
// caja/efectivo; si no, marcaría como disculpa respuestas legítimas del $0
// (ej: "No registraste gastos en este turno, el efectivo en caja es $0,00").
const RE_EN_ESTE_TURNO = /en este turno/g;
const CONTEXTO_CAJA =
  /(caja|efectivo|retiros?|arqueo|cierre|apertura|movimientos?|ventas?|gastos?|cobros?)/;

/** Frases de disculpa / auto-referencia al proceso presentes (vacío = limpio). */
export function disculpasDetectadas(texto: string): string[] {
  const n = normalizar(texto ?? '');
  const halladas = FRASES_DISCULPA.filter((f) => n.includes(f));
  for (const m of n.matchAll(RE_EN_ESTE_TURNO)) {
    const idx = m.index ?? 0;
    const ventana = n.slice(Math.max(0, idx - 80), idx + m[0].length + 30);
    if (!CONTEXTO_CAJA.test(ventana)) halladas.push('en este turno');
  }
  return [...new Set(halladas)];
}

/** `sinDisculpas`: sin disculpas ni comentarios sobre el proceso o respuestas anteriores. */
export function cumpleSinDisculpas(texto: string): boolean {
  return disculpasDetectadas(texto).length === 0;
}

/**
 * Oferta de hacer una tarea que el comerciante YA pidió (bug real: ante
 * "Armame una lista para pedirle al proveedor", Binny respondió "¿Querés que te
 * genere ahora mismo esa lista?" en lugar de generarla). NO incluye "muestre":
 * la repregunta legítima de desambiguación usa "¿Querés que te muestre de hoy,
 * de la semana o del mes?" y no debe marcarse.
 */
const RE_OFRECER_LO_PEDIDO =
  /(?:queres|quieres)\s+que\s+te\s+(?:genere|arme|prepare|haga|calcule|saque|busque)\b/;

/** `sinOfrecerLoPedido`: no ofrece hacer lo que el comerciante ya pidió. */
export function cumpleSinOfrecerLoPedido(texto: string): boolean {
  return !RE_OFRECER_LO_PEDIDO.test(normalizar(texto ?? ''));
}

/**
 * Pregunta de oferta al cierre (el sistema ya ofrece el seguimiento). Incluye
 * "¿querés que…?", "¿querés ver…?", "¿te gustaría…?", "¿te armo…?" y variantes
 * de ofrecer una acción más. Se evalúa sobre el texto normalizado (sin acentos).
 */
const RE_OFERTA_FINAL =
  /(?:queres|quieres|te gustaria|te armo|te preparo|te genero|te muestro|te paso|te dejo|te hago|te calculo)\b/;

/**
 * `sinOfertaFinal`: cuando la respuesta YA tiene contenido (una tabla de
 * resultados o ≥120 caracteres), NO debe TERMINAR con una pregunta de oferta
 * ("¿querés que…?", "¿querés ver…?", "¿te gustaría…?", "¿te armo…?"). Si la
 * respuesta es una repregunta corta de desambiguación (o no tiene contenido
 * real), el criterio NO aplica.
 */
export function cumpleSinOfertaFinal(texto: string): boolean {
  const t = quitarBloquesDeCodigo(texto ?? '').trim();
  if (t.length === 0) return true;
  const tieneTabla = TIENE_TABLA_MARKDOWN.test(t);
  const tieneContenido = tieneTabla || t.length >= 120;
  // Sin contenido real: no aplica (cubre la repregunta corta de desambiguación).
  if (!tieneContenido) return true;
  // Repregunta de desambiguación (sin datos a la vista): no aplica. Se exige que
  // no haya cifras ni tabla para no dejar pasar un análisis que cierre ofreciendo.
  if (cumpleRepregunta(t) && !/\d/.test(t) && !tieneTabla) return true;
  const lineas = t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const ultima = lineas[lineas.length - 1] ?? '';
  const esPregunta = ultima.endsWith('?') || ultima.endsWith('？');
  if (!esPregunta) return true;
  return !RE_OFERTA_FINAL.test(normalizar(ultima));
}

/**
 * `debeMencionarAlguna`: al menos UNA de las frases aparece en el texto
 * (case/acento-insensible). Sirve para probar que el modelo reutilizó datos de
 * un turno anterior (ej: la tabla que él mismo mostró).
 */
export function cumpleDebeMencionarAlguna(texto: string, frases: string[]): boolean {
  const t = normalizar(texto ?? '');
  return frases.some((f) => t.includes(normalizar(f)));
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
  if (exige.respuestaCompleta && !cumpleRespuestaCompleta(texto))
    fallas.push('respuesta incompleta (anuncio sin contenido o cierre con ":")');
  if (exige.sugerenciasEnvueltas && !cumpleSugerenciasEnvueltas(texto)) fallas.push('sugerencias sueltas (fuera de ```seguir)');
  if (exige.sinDisculpas && !cumpleSinDisculpas(texto))
    fallas.push(`se disculpó o habló de su proceso (${disculpasDetectadas(texto).join(', ') || 'disculpa'})`);
  if (exige.sinOfrecerLoPedido && !cumpleSinOfrecerLoPedido(texto))
    fallas.push('ofreció hacer algo que el comerciante ya había pedido');
  if (exige.sinOfertaFinal && !cumpleSinOfertaFinal(texto))
    fallas.push('cerró con una pregunta de oferta (¿querés que…?)');
  if (
    exige.debeMencionarAlguna &&
    exige.debeMencionarAlguna.length > 0 &&
    !cumpleDebeMencionarAlguna(texto, exige.debeMencionarAlguna)
  )
    fallas.push(
      `no reutilizó los datos previos (esperaba mencionar: ${exige.debeMencionarAlguna.slice(0, 3).join(', ')}…)`,
    );
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
