/**
 * Corpus de evaluación de los comportamientos "desambiguación" (T1) y
 * "seguimiento sugerido" (T2) de Binny.
 *
 * Vive separado de `chat.guia.evaluacion.ts` porque estos casos no validan la
 * recuperación del manual ni el camino de menú: validan CÓMO cierra Binny una
 * respuesta.
 *
 * Cada caso declara:
 *   - tipo:
 *       'desambiguacion' → la pregunta es ambigua o clara y se evalúa si
 *         Binny hace UNA repregunta corta (o si responde sin repreguntar).
 *       'seguimiento'    → la respuesta debe cerrar con un bloque ```seguir
 *         de 2-3 preguntas cortas, en voz del comerciante y sin tecnicismos.
 *       'datos'          → la respuesta muestra resultados del negocio con
 *         títulos legibles y SIN filtrar SQL ni código (sin SELECT … FROM,
 *         sin JOIN y sin bloques ```sql).
 *   - debe_mencionar: frases que la respuesta DEBE incluir (todas).
 *   - debe_mencionar_alguna: frases alternativas; basta con que aparezca UNA
 *     (se usa para la repregunta de período, donde alcanza con nombrar una
 *     unidad de tiempo).
 *   - no_debe: frases prohibidas (tecnicismos, bloques de creación, etc.).
 *   - espera_repregunta: solo en desambiguación. `true` = la respuesta debe
 *     ser una repregunta corta; `false` = debe responder sin repreguntar.
 *
 * El modo determinístico (sin LLM) valida el corpus, que `seguir` esté
 * autorizado y que el prompt describa el bloque y la regla de desambiguación;
 * el modo `--llm` puntúa la respuesta real del modelo. Ver
 * scripts/evaluar-guia.mts.
 */

export type TipoCasoBinny = 'desambiguacion' | 'seguimiento' | 'datos';

export interface CasoBinnyEvaluacion {
  /** Identificador estable y único del caso. */
  id: string;
  /** Comportamiento evaluado. */
  tipo: TipoCasoBinny;
  /** Pregunta del comerciante, en lenguaje natural. */
  pregunta: string;
  /** Frases que la respuesta debe incluir (todas). */
  debe_mencionar: string[];
  /** Frases alternativas: la respuesta debe incluir al menos una. */
  debe_mencionar_alguna: string[];
  /** Frases prohibidas en la respuesta. */
  no_debe: string[];
  /**
   * Solo desambiguación: `true` = debe repreguntar antes de responder;
   * `false` = debe responder sin repreguntar.
   */
  espera_repregunta?: boolean;
}

/**
 * Tecnicismos que NUNCA deben aparecer en las preguntas sugeridas del bloque
 * `seguir` (el comerciante ve botones, no internos de la base).
 */
export const TERMINOS_TECNICOS_SEGUIR: string[] = [
  'sql',
  'select',
  'tabla',
  'tablas',
  'columna',
  'columnas',
  'timestamp',
  'base de datos',
  'join',
  'query',
];

/**
 * Prohibiciones comunes a TODO el corpus Binny: Binny no crea datos del negocio
 * y no filtra tecnicismos al comerciante.
 */
export const NO_DEBE_BINNY_GLOBAL: string[] = [
  'crear_producto',
  'crear_gasto',
  'crear_recordatorio',
  'crear_proveedor',
  'cambiar_modulo',
  '```crear',
  'te genero',
  'te preparo',
  'hacé clic en confirmar',
];

export const CORPUS_BINNY_EVALUACION: CasoBinnyEvaluacion[] = [
  // --- Desambiguación ---
  {
    id: 'desamb_vendi_cuando',
    tipo: 'desambiguacion',
    pregunta: '¿Cuánto vendí?',
    debe_mencionar: [],
    debe_mencionar_alguna: ['hoy', 'semana', 'mes', 'ayer', 'período', 'periodo'],
    no_debe: ['venta_total', 'item_subtotal'],
    espera_repregunta: true,
  },
  {
    id: 'desamb_gaste_cuando',
    tipo: 'desambiguacion',
    pregunta: '¿Cuánto gasté?',
    debe_mencionar: [],
    debe_mencionar_alguna: ['hoy', 'semana', 'mes', 'ayer', 'período', 'periodo'],
    no_debe: ['gasto_total'],
    espera_repregunta: true,
  },
  {
    id: 'clara_vendi_hoy',
    tipo: 'desambiguacion',
    pregunta: '¿Cuánto vendí hoy?',
    debe_mencionar: [],
    debe_mencionar_alguna: ['45.000', '45000', '45', 'venta', 'vendiste', 'vendí'],
    no_debe: ['¿de hoy, de la semana o del mes?'],
    espera_repregunta: false,
  },
  {
    id: 'clara_gaste_semana',
    tipo: 'desambiguacion',
    pregunta: '¿Cuánto gasté esta semana?',
    debe_mencionar: [],
    debe_mencionar_alguna: ['95.000', '95000', '95', 'gasto', 'gastaste', 'gast'],
    no_debe: ['¿de hoy, de la semana o del mes?'],
    espera_repregunta: false,
  },

  // --- Seguimiento sugerido (bloque ```seguir) ---
  {
    id: 'seguir_ventas_semana',
    tipo: 'seguimiento',
    pregunta: '¿Cómo vienen las ventas de esta semana?',
    debe_mencionar: [],
    debe_mencionar_alguna: [],
    no_debe: [],
  },
  {
    id: 'seguir_stock_bajo',
    tipo: 'seguimiento',
    pregunta: '¿Qué productos tengo con stock bajo?',
    debe_mencionar: [],
    debe_mencionar_alguna: [],
    no_debe: [],
  },
  {
    id: 'seguir_gastos_mes',
    tipo: 'seguimiento',
    pregunta: '¿Cuánto gasté este mes?',
    debe_mencionar: [],
    debe_mencionar_alguna: [],
    no_debe: [],
  },
  {
    // Red de seguridad del bug reportado: la respuesta NO puede ser solo el
    // bloque (el texto sin el bloque debe tener contenido; ver
    // `puntuarSeguimiento` en scripts/evaluar-guia.mts) y las sugerencias no
    // pueden ser las tres del ejemplo del prompt.
    id: 'seguir_con_contenido',
    tipo: 'seguimiento',
    pregunta: '¿Cómo vienen las ventas de hoy?',
    debe_mencionar: [],
    debe_mencionar_alguna: [],
    no_debe: [
      '¿Cómo viene la cobranza?',
      '¿Qué productos tengo sin movimiento?',
      '¿Cuánto gasté este mes?',
    ],
  },

  // --- Datos sin filtración de SQL (regresión del bug reportado) ---
  // El caso clásico: el modelo respondió con el SELECT de ventas bajo costo a
  // la vista. La respuesta debe traer títulos de comerciante y números, jamás
  // la consulta. El criterio `contieneSql` (ver evaluar-guia.mts) lo verifica.
  {
    id: 'datos_venta_bajo_costo',
    tipo: 'datos',
    pregunta: '¿Vendí productos por debajo de mi costo?',
    debe_mencionar: [],
    debe_mencionar_alguna: ['producto', 'precio', 'costo', 'pérdida', 'unidades'],
    no_debe: [],
  },
  {
    id: 'datos_stock_bajo',
    tipo: 'datos',
    pregunta: '¿Qué productos tengo con stock bajo?',
    debe_mencionar: [],
    debe_mencionar_alguna: ['producto', 'stock', 'cantidad', 'mínimo', 'reponer'],
    no_debe: [],
  },
  {
    id: 'datos_clientes_deuda',
    tipo: 'datos',
    pregunta: '¿Quiénes me deben más?',
    debe_mencionar: [],
    debe_mencionar_alguna: ['cliente', 'deuda', 'saldo', 'debe'],
    no_debe: [],
  },
];
