/**
 * Corpus de evaluación del "modo guía" de Binny (T6).
 *
 * Cada caso es una pregunta de comerciante del tipo "¿cómo…?" y declara:
 *   - pantalla_esperada: el `id` de la entrada del manual que la recuperación
 *     determinística debe devolver para esa pregunta.
 *   - debe_mencionar: palabras o frases clave que la respuesta del modelo DEBE
 *     incluir (el camino de menú y/o el prerrequisito).
 *   - no_debe: nada de bloques de creación ni promesas de tarjetas.
 *
 * El modo determinístico (sin LLM) valida la recuperación y el prompt; el modo
 * `--llm` puntúa `debe_mencionar` / `no_debe` sobre la respuesta real del
 * modelo. Ver scripts/evaluar-guia.mts.
 */

export interface CasoGuiaEvaluacion {
  /** Identificador estable y único del caso. */
  id: string;
  /** Pregunta del comerciante, en lenguaje natural. */
  pregunta: string;
  /** `id` de la entrada de chat.manual.ts que debe recuperarse. */
  pantalla_esperada: string;
  /** Palabras/frases que la respuesta debe mencionar (menú y/o prerrequisito). */
  debe_mencionar: string[];
  /** Palabras/frases prohibidas en la respuesta (bloques de creación/tarjetas). */
  no_debe: string[];
}

/**
 * Prohibiciones comunes a TODO el corpus: Binny ya no crea datos del negocio
 * (ni por fence ni por tool) y nunca promete tarjetas de la UI.
 */
export const NO_DEBE_GLOBAL: string[] = [
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

export const CORPUS_GUIA_EVALUACION: CasoGuiaEvaluacion[] = [
  {
    id: 'combo',
    pregunta: '¿Cómo armo un combo de fideos con salsa?',
    pantalla_esperada: 'combos',
    debe_mencionar: ['Productos', 'Combos', 'Nuevo Combo'],
    no_debe: ['crear_combo'],
  },
  {
    id: 'compra',
    pregunta: '¿Cómo cargo una compra de mercadería de un proveedor?',
    pantalla_esperada: 'compras',
    debe_mencionar: ['Compras', 'Nueva Compra', 'proveedor'],
    no_debe: ['crear_compra'],
  },
  {
    id: 'alta_producto',
    pregunta: '¿Cómo doy de alta un producto nuevo?',
    pantalla_esperada: 'productos',
    debe_mencionar: ['Productos', 'Nuevo Producto', 'Código interno'],
    no_debe: [],
  },
  {
    id: 'iva',
    pregunta: '¿Cómo habilito el IVA y las alícuotas?',
    pantalla_esperada: 'configuracion',
    debe_mencionar: ['Configuración', 'Impuestos', 'IVA'],
    no_debe: [],
  },
  {
    id: 'promociones',
    pregunta: '¿Cómo creo una promoción 3x2 en el sistema?',
    pantalla_esperada: 'promociones',
    debe_mencionar: ['Configuración', 'Promociones', 'Nueva Promoción'],
    no_debe: [],
  },
  {
    id: 'cierre_caja',
    pregunta: '¿Cómo hago el cierre de caja del turno?',
    pantalla_esperada: 'caja',
    debe_mencionar: ['Caja', 'Cerrar Turno'],
    no_debe: [],
  },
  {
    id: 'cobrar_deuda',
    pregunta: '¿Cómo le cobro la deuda a un cliente de la cuenta corriente?',
    pantalla_esperada: 'clientes',
    debe_mencionar: ['Clientes', 'Cobrar', 'deuda'],
    no_debe: [],
  },
  {
    id: 'importar_catalogo',
    pregunta: '¿Cómo importo el catálogo desde un Excel?',
    pantalla_esperada: 'productos',
    debe_mencionar: ['Productos', 'Importar Excel'],
    no_debe: [],
  },
  {
    id: 'etiquetas',
    pregunta: '¿Cómo imprimo las etiquetas de precios?',
    pantalla_esperada: 'productos',
    debe_mencionar: ['Productos', 'Imprimir Etiquetas'],
    no_debe: [],
  },
  {
    id: 'usuarios_permisos',
    pregunta: '¿Cómo creo un usuario operador con permisos limitados?',
    pantalla_esperada: 'usuarios',
    debe_mencionar: ['Usuarios', 'Nuevo Usuario', 'Permisos'],
    no_debe: [],
  },
  {
    id: 'restaurar_respaldo',
    pregunta: '¿Cómo restauro una copia de seguridad?',
    pantalla_esperada: 'respaldos',
    debe_mencionar: ['Configuración', 'Copias de Seguridad', 'restaurar'],
    no_debe: [],
  },
  {
    id: 'balanza',
    pregunta: '¿Cómo configuro la balanza para leer productos por peso?',
    pantalla_esperada: 'configuracion',
    debe_mencionar: ['Configuración', 'Balanza'],
    no_debe: [],
  },
  {
    id: 'presupuesto',
    pregunta: '¿Cómo hago un presupuesto para un cliente?',
    pantalla_esperada: 'presupuestos',
    debe_mencionar: ['Presupuestos', 'presupuesto'],
    no_debe: [],
  },
  {
    id: 'gasto',
    pregunta: '¿Cómo registro un gasto de un servicio?',
    pantalla_esperada: 'gastos',
    debe_mencionar: ['Gastos', 'Nuevo Gasto'],
    no_debe: [],
  },
  {
    id: 'proveedor',
    pregunta: '¿Cómo doy de alta un proveedor nuevo?',
    pantalla_esperada: 'proveedores',
    debe_mencionar: ['Proveedores', 'Nuevo Proveedor', 'Nombre'],
    no_debe: [],
  },
  {
    id: 'recordatorio',
    pregunta: '¿Cómo agendo un recordatorio para pagar un vencimiento?',
    pantalla_esperada: 'recordatorios',
    debe_mencionar: ['Recordatorio', 'barra superior'],
    no_debe: [],
  },
  {
    id: 'paleta',
    pregunta: '¿Cómo abro la paleta de comandos para buscar una pantalla?',
    pantalla_esperada: 'paleta',
    debe_mencionar: ['Ctrl+K', 'paleta'],
    no_debe: [],
  },
  {
    id: 'modulos',
    pregunta: '¿Cómo activo el módulo de combos?',
    pantalla_esperada: 'modulos',
    debe_mencionar: ['Configuración', 'Módulos y Catálogo'],
    no_debe: [],
  },
  {
    id: 'informe',
    pregunta: '¿Cómo veo el informe financiero del mes?',
    pantalla_esperada: 'informe',
    debe_mencionar: ['Informe Financiero', 'período'],
    no_debe: [],
  },
  {
    id: 'categoria',
    pregunta: '¿Cómo agrego una categoría de productos?',
    pantalla_esperada: 'categorias',
    debe_mencionar: ['Categorías', 'Nueva Categoría'],
    no_debe: [],
  },
  {
    id: 'licencia',
    pregunta: '¿Cómo activo la licencia del sistema?',
    pantalla_esperada: 'activacion',
    debe_mencionar: ['Activación', 'clave de licencia'],
    no_debe: [],
  },
];
