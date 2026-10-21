/**
 * Manual estructurado de la interfaz (Binny modo guía).
 *
 * Binny dejó de crear/modificar datos del negocio y pasó a ser un guía de la
 * interfaz. Este archivo es su única fuente de verdad sobre las pantallas: cada
 * entrada describe su categoría (primeros pasos u uso diario), nombre visible,
 * cómo se llega (menú → submenú → pestaña), prerrequisitos, pasos numerados,
 * campos obligatorios, errores comunes y palabras clave para la recuperación
 * determinística.
 *
 * La inyección en el prompt es en dos capas:
 *   1. ÍNDICE_MANUAL: una línea por pantalla (siempre, presupuesto ≤ 2.000 chars).
 *   2. Detalle recuperado por palabras clave de la pregunta del comerciante
 *      (1 a 3 entradas, presupuesto total ≤ 6.000 chars).
 */

export interface EntradaManual {
  /** Identificador estable (útil para el test de cobertura). */
  id: string;
  /** Nombre visible de la pantalla o flujo. */
  nombre: string;
  /** Sección de la FAQ: onboarding vs uso diario. */
  categoria: 'primeros_pasos' | 'uso_diario';
  /** Camino exacto: menú → submenú → pestaña. */
  como_se_llega: string;
  /** Módulo/rol/estado necesario antes de empezar. */
  prerrequisitos: string;
  /** Pasos numerados para completar la tarea. */
  pasos: string[];
  /** Campos que no se pueden dejar vacíos. */
  campos_obligatorios: string[];
  /** Errores y bloqueos frecuentes. */
  errores_comunes: string[];
  /** Palabras clave para recuperar esta entrada desde la pregunta. */
  palabras_clave: string[];
  /**
   * Explicación en lenguaje llano: qué es esta pantalla y para qué le sirve al
   * comerciante. Sin jerga técnica: lo lee alguien que nunca usó el sistema.
   */
  para_que_sirve: string;
  /**
   * Las cosas concretas que el comerciante puede hacer en esta pantalla.
   * Frases cortas, en segunda persona ("Cargar…", "Ver…", "Cobrar…").
   */
  que_podes_hacer: string[];
}

export const MANUAL_ENTRADAS: EntradaManual[] = [
  {
    id: 'dashboard',
    nombre: 'Dashboard (Inicio)',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Dashboard (admin)',
    prerrequisitos: 'Rol admin y sesión iniciada.',
    pasos: [
      'Ingresá con tu usuario administrador.',
      'En el menú lateral tocá Dashboard.',
      'Mirá las tarjetas: ventas de hoy, estado de caja, deuda de clientes, gastos y compras del mes e inventario.',
      'Revisá las píldoras de Binny (alertas) y el brief del día; tocá una píldora para que Binny te aconseje.',
    ],
    campos_obligatorios: [],
    errores_comunes: ['Si no ves Dashboard, tu usuario es operador (no tiene ese acceso).'],
    palabras_clave: ['dashboard', 'inicio', 'panel', 'resumen', 'metricas', 'pildoras', 'brief', 'alertas'],
    para_que_sirve:
      'Es la primera pantalla que ves al entrar y sirve para saber de un vistazo cómo está el negocio hoy. Reúne las ventas del día, el estado de la caja, la deuda de los clientes, los gastos y compras del mes y el inventario, sin que tengas que abrir cada sección por separado. También te muestra las alertas de Binny y un resumen del día para que reacciones rápido si algo llama la atención.',
    que_podes_hacer: [
      'Ver las ventas de hoy y el estado de la caja',
      'Consultar cuánto te deben los clientes',
      'Revisar los gastos y las compras del mes',
      'Mirar el estado del inventario',
      'Leer las alertas y el resumen del día de Binny',
    ],
  },
  {
    id: 'wizard',
    nombre: 'Wizard de bienvenida',
    categoria: 'primeros_pasos',
    como_se_llega: 'Se abre solo la primera vez (Dashboard)',
    prerrequisitos: 'Primer uso tras la instalación, con usuario admin.',
    pasos: [
      'Al entrar por primera vez aparece el tutorial de bienvenida.',
      'Avanzá con Siguiente por cada paso (productos, caja, etc.).',
      'Podés tocar Omitir tutorial para cerrarlo.',
    ],
    campos_obligatorios: [],
    errores_comunes: ['Si lo omitiste, no se vuelve a abrir solo.'],
    palabras_clave: ['bienvenida', 'tutorial', 'wizard', 'primeros pasos', 'omitir'],
    para_que_sirve:
      'Es el tutorial que aparece la primera vez que abrís el sistema y sirve para que conozcas las pantallas principales sin perderte. Te explica en pocos pasos para qué sirve cada parte (productos, caja, ventas) antes de que empieces a trabajar. Es la guía de arranque para dejar de sentir el programa como algo ajeno.',
    que_podes_hacer: [
      'Conocer las pantallas principales del sistema',
      'Avanzar paso a paso por el tutorial',
      'Omitir el tutorial si ya lo conocés',
    ],
  },
  {
    id: 'pos',
    nombre: 'Punto de Venta (POS)',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Punto de Venta',
    prerrequisitos: 'Caja abierta (Caja → Abrir Turno) y al menos un medio de pago habilitado.',
    pasos: [
      'Abrí la caja en Caja → Abrir Turno.',
      'En Punto de Venta buscá el producto con F2 (o escaneá el código de barras).',
      'Ajustá la cantidad; Alt+A auto-agrega 1 unidad.',
      'Elegí el cliente con F3 (opcional, para cuenta corriente).',
      'Elegí el medio de pago: F5 efectivo, F6 débito, F7 crédito, F8 transferencia o F9 Mercado Pago.',
      'Para varios medios usá Alt+C (pago combinado).',
      'Cobrá con F10 o cobrá e imprimí con F12.',
      'Si es efectivo, calculá el vuelto con F4.',
    ],
    campos_obligatorios: [],
    errores_comunes: [
      'No se puede cobrar sin caja abierta.',
      'Un producto desactivado o sin stock (si "permitir sin stock" está apagado) no se agrega.',
    ],
    palabras_clave: ['pos', 'punto de venta', 'vender', 'cobrar', 'venta', 'carrito', 'ticket', 'f10', 'facturar', 'medio de pago', 'efectivo'],
    para_que_sirve:
      'Acá vivís el día a día del negocio: cada venta que cobrás queda registrada con su forma de pago y el sistema descuenta el stock solo. Es la pantalla que más vas a usar, pensada para cobrar rápido con el teclado o el lector de códigos de barras. Sirve para vender de mostrador y para dejar constancia de cada operación.',
    que_podes_hacer: [
      'Buscar productos por nombre, código o código de barras',
      'Cobrar en efectivo, débito, crédito, transferencia o Mercado Pago',
      'Asociar la venta a un cliente para cuenta corriente',
      'Combinar varios medios de pago en una misma venta',
      'Calcular el vuelto en efectivo',
      'Cobrar e imprimir el ticket en un solo paso',
    ],
  },
  {
    id: 'pos_extras',
    nombre: 'POS: descuentos, espera, kiosko y balanza',
    categoria: 'uso_diario',
    como_se_llega: 'Punto de Venta → acciones y atajos',
    prerrequisitos: 'Caja abierta. Los descuentos requieren la clave de un administrador.',
    pasos: [
      'Descuento manual: Ctrl+D, ingresá el monto y autorizá con la clave de admin.',
      'Recargo o Delivery: Ctrl+E y elegí el recargo configurado.',
      'Nueva venta en espera: Ctrl+T (o Alt+N); cambiá de pestaña con Ctrl+1..9 y cerrá con Ctrl+W.',
      'Modo kiosko: F11 (pantalla completa); F11 de nuevo para salir.',
      'Producto por peso o importe: si la balanza EAN-13 está activa, escaneá la etiqueta y se carga el peso o el importe según el prefijo configurado.',
      'Guardar como presupuesto: armá el carrito y usá Guardar Presupuesto; se emite el ticket del presupuesto.',
    ],
    campos_obligatorios: [],
    errores_comunes: [
      'El descuento sin clave de admin se rechaza.',
      'Una etiqueta de balanza mal escaneada se carga como código normal.',
    ],
    palabras_clave: ['descuento', 'recargo', 'delivery', 'venta en espera', 'pestana', 'kiosko', 'kiosco', 'balanza', 'peso', 'plu', 'presupuesto', 'combinado'],
    para_que_sirve:
      'Reúne las funciones extra del Punto de Venta para cuando la venta no es la típica. Sirve para dar descuentos autorizados, sumar recargos o delivery, atender a varios clientes a la vez y vender productos por peso. Así resolvés los casos especiales sin salir de la pantalla de venta.',
    que_podes_hacer: [
      'Aplicar un descuento manual con autorización de un administrador',
      'Agregar un recargo o un cargo por delivery',
      'Dejar varias ventas abiertas en espera y volver a ellas',
      'Usar el modo kiosko a pantalla completa',
      'Vender productos por peso o por importe con la balanza',
      'Guardar el carrito como presupuesto',
    ],
  },
  {
    id: 'caja',
    nombre: 'Caja',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Caja',
    prerrequisitos: 'Admin u operador con permiso de caja. Un solo turno abierto por terminal.',
    pasos: [
      'Abrir turno: Caja → Abrir Turno e ingresá el monto inicial en efectivo.',
      'Retiro de efectivo: Caja → Retirar, ingresá el monto y autorizá con contraseña de admin.',
      'Cerrar turno: Caja → Cerrar Turno, contá el efectivo y confirmá; el sistema muestra el arqueo (sobrante/faltante).',
      'Ver arqueo en vivo: botón Ver Arqueo en Vivo (admin).',
      'Anular venta: desde la venta o su detalle usá Anular y elegí el motivo; restaura el stock.',
      'Reimprimir: desde el detalle de la venta usá Reimprimir ticket.',
    ],
    campos_obligatorios: ['Monto inicial (apertura)', 'Monto contado (cierre)', 'Motivo (anulación)'],
    errores_comunes: [
      'No se puede abrir un turno si ya hay uno abierto.',
      'El retiro sin clave admin se rechaza.',
      'La diferencia de arqueo no bloquea el cierre, queda registrada.',
    ],
    palabras_clave: ['caja', 'turno', 'abrir caja', 'cerrar caja', 'arqueo', 'retiro', 'retirar', 'anular venta', 'reimprimir', 'efectivo'],
    para_que_sirve:
      'Sirve para controlar el efectivo y el movimiento del turno: con cuánto abrís, cuánto retirás y con cuánto cerrás. Al cerrar, el sistema compara lo que contaste con lo que debería haber y te muestra si sobra o falta dinero. Es la pantalla que te da tranquilidad sobre la plata del día.',
    que_podes_hacer: [
      'Abrir el turno con el monto inicial en efectivo',
      'Retirar efectivo de la caja con autorización',
      'Cerrar el turno contando el efectivo y ver el arqueo',
      'Ver el arqueo en vivo durante el turno',
      'Anular una venta y devolver el stock',
      'Reimprimir el ticket de una venta',
    ],
  },
  {
    id: 'inventario',
    nombre: 'Inventario',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Inventario (pestañas Existencias / Vencimientos)',
    prerrequisitos: 'Admin o permiso de stock.',
    pasos: [
      'Existencias: consultá el stock consolidado, filtrá stock bajo/sin stock y mirá los movimientos.',
      'Ajustar stock: botón Ajustar inventario (o Ajustar en una fila); elegí producto, tipo (ajuste, entrada, salida o merma) y cantidad.',
      'Vencimientos: pestaña Vencimientos, filtrá ≤7/15/30/60 días y usá Merma para dar de baja un lote vencido.',
      'Exportar: botón Exportar a Excel en Existencias o en Vencimientos.',
    ],
    campos_obligatorios: ['Cantidad del ajuste', 'Motivo'],
    errores_comunes: ['La merma descuenta stock y no se puede deshacer.'],
    palabras_clave: ['inventario', 'stock', 'existencias', 'ajuste', 'merma', 'vencimiento', 'vencimientos', 'movimiento', 'exportar'],
    para_que_sirve:
      'Sirve para saber con qué stock contás y mantenerlo al día. Acá ves las existencias consolidadas, detectás qué está por agotarse y controlás los vencimientos de los productos. Es la pantalla que evita que vendas algo que no tenés o que se te venza mercadería.',
    que_podes_hacer: [
      'Consultar el stock de todos los productos',
      'Filtrar lo que está bajo de stock o sin stock',
      'Ajustar el stock con entradas, salidas o mermas',
      'Ver el historial de movimientos de un producto',
      'Controlar los vencimientos próximos y dar de baja lotes vencidos',
      'Exportar las existencias o los vencimientos a Excel',
    ],
  },
  {
    id: 'productos',
    nombre: 'Productos',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Productos (pestaña Productos)',
    prerrequisitos: 'Admin o permiso de productos. Para importar, precios masivos y etiquetas, el módulo correspondiente.',
    pasos: [
      'Nuevo: Productos → Nuevo Producto; completá los obligatorios y Guardar.',
      'Editar: tocá el lápiz de la fila.',
      'Activar/desactivar: usá el interruptor de estado de la fila.',
      'Eliminar: menú de la fila → Eliminar.',
      'Importar Excel: botón Importar Excel (descargá la plantilla; crea marcas, categorías y unidades nuevas).',
      'Actualizar precios (%): botón Actualizar Precios (%), elegí % o margen y aplicá al filtro.',
      'Imprimir etiquetas: botón Imprimir Etiquetas (módulo Etiquetas).',
      'Exportar: botón Exportar a Excel.',
    ],
    campos_obligatorios: ['Nombre', 'Código interno', 'Unidad', 'Precio de costo', 'Precio de venta', 'Stock'],
    errores_comunes: [
      'El código interno debe ser único.',
      'El código de barras solo admite números.',
      'No podés eliminar un producto con ventas: desactivalo.',
    ],
    palabras_clave: ['producto', 'productos', 'alta producto', 'nuevo producto', 'codigo interno', 'precio', 'importar', 'excel', 'precios masivos', 'etiquetas', 'catalogo'],
    para_que_sirve:
      'Es el catálogo del negocio: todo lo que vendés tiene que estar cargado acá. Sirve para dar de alta cada producto con su precio, su costo y su stock, y para mantenerlos actualizados. Si un producto no está en esta pantalla, no lo vas a poder cobrar en el Punto de Venta.',
    que_podes_hacer: [
      'Cargar un producto nuevo con sus datos y precios',
      'Editar o actualizar la información de un producto',
      'Activar o desactivar productos sin borrarlos',
      'Importar un listado de productos desde Excel',
      'Actualizar precios en masa por porcentaje o margen',
      'Imprimir etiquetas y exportar el catálogo a Excel',
    ],
  },
  {
    id: 'combos',
    nombre: 'Combos / Kits',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Productos → pestaña Combos',
    prerrequisitos: 'Módulo Combos activo y al menos un producto cargado.',
    pasos: [
      'Andá a Productos y tocá la pestaña Combos.',
      'Nuevo Combo.',
      'Completá Nombre y Código interno.',
      'Agregá los productos componentes con sus cantidades.',
      'Definí el Precio de venta del combo.',
      'Guardar. Al venderlo se descuenta el stock de cada componente.',
    ],
    campos_obligatorios: ['Nombre', 'Código interno', 'Al menos un producto componente', 'Precio de venta'],
    errores_comunes: [
      'El combo debe tener al menos un producto componente.',
      'Si el módulo Combos está apagado no aparece la pestaña.',
    ],
    palabras_clave: ['combo', 'combos', 'kit', 'compuesto', 'componentes'],
    para_que_sirve:
      'Sirve para vender varios productos juntos como si fueran uno solo, a un precio propio. Es útil para armar promos o packs (por ejemplo, un combo de desayuno) y cobrarlos de una vez. Al venderlo, el sistema descuenta el stock de cada producto que lo compone.',
    que_podes_hacer: [
      'Armar un combo con varios productos y sus cantidades',
      'Definir el precio de venta del conjunto',
      'Vender el combo como un solo ítem en el POS',
    ],
  },
  {
    id: 'categorias',
    nombre: 'Categorías',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Categorías (sección Administración, admin)',
    prerrequisitos: 'Módulo Categorías activo.',
    pasos: [
      'Nueva Categoría.',
      'Escribí el Nombre y Guardar.',
      'Activá/desactivá una categoría con su interruptor.',
    ],
    campos_obligatorios: ['Nombre'],
    errores_comunes: ['Categorías múltiples por producto se habilitan en Configuración → Módulos y Catálogo.'],
    palabras_clave: ['categoria', 'categorias', 'rubro', 'familia'],
    para_que_sirve:
      'Sirve para agrupar los productos por rubro o familia, lo que después te ayuda a ordenar el catálogo y a encontrar las cosas más rápido. Es una forma simple de clasificar lo que vendés.',
    que_podes_hacer: [
      'Crear categorías para agrupar productos',
      'Activar o desactivar una categoría',
      'Ordenar el catálogo por rubro o familia',
    ],
  },
  {
    id: 'marcas',
    nombre: 'Marcas',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Marcas (sección Administración, admin)',
    prerrequisitos: 'Módulo Marcas activo.',
    pasos: ['Nueva Marca.', 'Escribí el Nombre y Guardar.', 'Activá/desactivá una marca con su interruptor.'],
    campos_obligatorios: ['Nombre'],
    errores_comunes: [],
    palabras_clave: ['marca', 'marcas', 'fabricante'],
    para_que_sirve:
      'Sirve para registrar las marcas o fabricantes de tus productos y poder agruparlos por marca. Es útil cuando manejás varias marcas y querés ubicarlas o filtrarlas con facilidad.',
    que_podes_hacer: [
      'Cargar una marca o fabricante',
      'Activar o desactivar una marca',
      'Agrupar los productos por marca',
    ],
  },
  {
    id: 'unidades',
    nombre: 'Unidades de medida',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Unidades (sección Administración, admin)',
    prerrequisitos: 'Rol admin.',
    pasos: ['Nueva Unidad.', 'Completá la Abreviatura (ej: un., kg, L) y, si querés, el Nombre.', 'Guardar.'],
    campos_obligatorios: ['Abreviatura'],
    errores_comunes: ['La unidad "Unidades" (id 1) viene por defecto.'],
    palabras_clave: ['unidad', 'unidades', 'medida', 'kilo', 'litro', 'abreviatura'],
    para_que_sirve:
      'Sirve para definir cómo se mide cada producto: por unidad, por kilo, por litro, etc. Al cargar un producto elegís su unidad, y eso hace que el stock y las ventas se muestren en la medida correcta. Es clave para los productos que no se venden de a uno.',
    que_podes_hacer: [
      'Crear una unidad de medida con su abreviatura',
      'Elegir la unidad de cada producto',
      'Vender y controlar stock por peso o por volumen',
    ],
  },
  {
    id: 'compras',
    nombre: 'Compras',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Compras (módulo Proveedores)',
    prerrequisitos: 'Módulo Proveedores activo y al menos un proveedor cargado.',
    pasos: [
      'Nueva Compra.',
      'Elegí el proveedor.',
      'Agregá productos con cantidad y costo; si aplica, cargá vencimiento y lote.',
      'Con "Actualizar costo" activo, el costo del producto se recalcula.',
      'Agregá fletes o gastos asociados si corresponde.',
      'Confirmá la compra (suma stock).',
      'Escanear factura (OCR): botón Escanear Factura, subí o sacá la foto (o usá el QR para el celular); revisá los ítems y confirmá.',
      'Anular: menú de la fila → Anular (podés anular también los gastos asociados).',
      'Exportar: botón Exportar a Excel.',
    ],
    campos_obligatorios: ['Proveedor', 'Al menos un producto con cantidad y costo'],
    errores_comunes: ['Sin ítems no se confirma.', 'La anulación revierte el stock.'],
    palabras_clave: ['compra', 'compras', 'proveedor', 'mercaderia', 'factura', 'ocr', 'escanear', 'vencimiento', 'lote', 'actualizar costo', 'anular', 'reposicion'],
    para_que_sirve:
      'Sirve para registrar la mercadería que te llega de tus proveedores. Al cargar una compra, el sistema suma el stock y puede actualizar el costo de los productos solo. Es la pantalla que mantiene tu inventario y tus costos al día sin hacerlo a mano.',
    que_podes_hacer: [
      'Registrar una compra indicando proveedor y productos',
      'Cargar vencimiento y lote de la mercadería',
      'Actualizar el costo de los productos automáticamente',
      'Sumar fletes o gastos asociados a la compra',
      'Escanear una factura con la cámara para cargar los ítems',
      'Anular una compra y revertir el stock',
    ],
  },
  {
    id: 'proveedores',
    nombre: 'Proveedores',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Proveedores (admin, módulo Proveedores)',
    prerrequisitos: 'Módulo Proveedores activo.',
    pasos: ['Nuevo Proveedor.', 'Completá el Nombre (único obligatorio).', 'Opcional: teléfono, email, dirección y nota.', 'Guardar.'],
    campos_obligatorios: ['Nombre'],
    errores_comunes: ['Un proveedor NO es un cliente: los clientes se cargan en Clientes.'],
    palabras_clave: ['proveedor', 'proveedores', 'distribuidor', 'mayorista'],
    para_que_sirve:
      'Sirve para tener a mano los datos de las empresas o personas que te abastecen. Guardar el proveedor te permite asociarlo después a las compras y llevar un registro de a quién le comprás.',
    que_podes_hacer: [
      'Cargar los datos de un proveedor',
      'Guardar teléfono, correo y dirección para contactarlo',
      'Asociar el proveedor a las compras de mercadería',
    ],
  },
  {
    id: 'gastos',
    nombre: 'Gastos',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Gastos (pestañas Registrados / Programados)',
    prerrequisitos: 'Módulo Gastos activo.',
    pasos: [
      'Nuevo Gasto (Registrados): concepto, monto, categoría y medio de pago; Guardar.',
      'Anular: menú de la fila → Anular.',
      'Pestaña Programados: Nuevo/Programar Gasto.',
      'Elegí Única vez o Recurrente (diaria, semanal, quincenal, mensual o anual), la fecha de inicio y si es automático o con confirmación.',
      'En la lista: Pausar/Reanudar, Confirmar importe (boletas variables), Ejecutar ahora, Editar o Eliminar.',
      'Exportar: botón Exportar a Excel.',
    ],
    campos_obligatorios: ['Concepto', 'Monto'],
    errores_comunes: [
      'Un gasto programado no resta caja hasta que vence.',
      'Con "con confirmación", el sistema te pide el importe real de la boleta al vencer.',
    ],
    palabras_clave: ['gasto', 'gastos', 'egreso', 'programado', 'recurrente', 'pausar', 'ejecutar', 'boleta', 'servicio', 'alquiler'],
    para_que_sirve:
      'Sirve para anotar todo lo que sale de la caja y no es mercadería: alquiler, servicios, sueldos, impuestos. Registrarlos te muestra el gasto real del negocio y te ayuda a saber cuánto ganás de verdad. Además podés programar los gastos que se repiten para no olvidarte de ninguno.',
    que_podes_hacer: [
      'Registrar un gasto con su concepto, monto y forma de pago',
      'Anular un gasto cargado por error',
      'Programar gastos que se repiten (diarios, semanales o mensuales)',
      'Pausar, editar o adelantar un gasto programado',
      'Confirmar el importe real de una boleta variable al vencer',
      'Exportar los gastos a Excel',
    ],
  },
  {
    id: 'clientes',
    nombre: 'Clientes',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Clientes (módulo Clientes)',
    prerrequisitos: 'Módulo Clientes activo.',
    pasos: [
      'Nuevo Cliente: completá el Nombre y Guardar; cargá el celular para WhatsApp.',
      'Cuenta corriente: tocá Cobrar en la fila o abrí la cuenta del cliente.',
      'Registrar Cobro: elegí medio y monto.',
      'Registrar Ajuste/Cargo: botón Registrar Ajuste/Cargo (cargo o ajuste débito/crédito).',
      'Anular movimiento: en la lista de movimientos, Anular.',
      'Límite de fiado: en el alta/edición cargá el Límite de Crédito (0 = sin límite).',
      'WhatsApp: el botón WhatsApp envía el saldo; Extracto imprime el estado de cuenta.',
    ],
    campos_obligatorios: ['Nombre', 'Concepto y monto (en cargos y cobros)'],
    errores_comunes: [
      'No se puede cobrar ni ajustar sin un cliente.',
      'La venta a cuenta se bloquea si supera el límite de crédito.',
    ],
    palabras_clave: ['cliente', 'clientes', 'cuenta corriente', 'fiado', 'deuda', 'cobro', 'cobrar', 'cargo', 'ajuste', 'extracto', 'whatsapp', 'limite', 'saldo'],
    para_que_sirve:
      'Sirve para tener registrados a tus clientes y, sobre todo, para manejar la cuenta corriente o fiado. Acá ves cuánto te debe cada uno, registrás los pagos y controlás el límite de crédito. También te deja avisarle el saldo por WhatsApp o imprimirle su estado de cuenta.',
    que_podes_hacer: [
      'Cargar un cliente con su nombre y celular',
      'Cobrar la deuda de un cliente',
      'Registrar cargos y ajustes en la cuenta corriente',
      'Definir un límite de fiado por cliente',
      'Anular un movimiento cargado por error',
      'Enviar el saldo por WhatsApp o imprimir el extracto',
    ],
  },
  {
    id: 'presupuestos',
    nombre: 'Presupuestos',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Presupuestos (módulo Presupuestos)',
    prerrequisitos: 'Módulo Presupuestos activo. Caja abierta para crearlo desde el POS.',
    pasos: [
      'Crear: Nuevo Presupuesto (en Caja) abre el POS con el carrito; guardalo como presupuesto.',
      'Vender: el botón Vender carga el presupuesto en el POS con precios congelados.',
      'Imprimir: botón de ticket térmico (80/58mm).',
      'PDF A4: botón de hoja A4 formal.',
      'Cancelar: botón Cancelar (solo si está pendiente).',
    ],
    campos_obligatorios: [],
    errores_comunes: ['Un presupuesto convertido o cancelado no se puede cancelar de nuevo.'],
    palabras_clave: ['presupuesto', 'presupuestos', 'cotizacion', 'proforma', 'pdf', 'vender', 'cancelar'],
    para_que_sirve:
      'Sirve para preparar y guardar una cotización antes de cerrar la venta. Le mostrás el precio al cliente en un ticket o PDF y, si acepta, lo convertís en venta sin volver a cargar los productos. Es ideal para pedidos o trabajos que el cliente piensa antes de comprar.',
    que_podes_hacer: [
      'Armar un presupuesto con los productos y precios del momento',
      'Imprimir el presupuesto en ticket térmico o PDF A4',
      'Convertir un presupuesto en venta con los precios congelados',
      'Cancelar un presupuesto pendiente',
    ],
  },
  {
    id: 'informe',
    nombre: 'Informe Financiero',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Informe Financiero (admin)',
    prerrequisitos: 'Rol admin.',
    pasos: [
      'Elegí el período (hoy, semana, mes, año o personalizado).',
      'Mirá ventas, compras, gastos, descuentos, recargos, retiros, deuda y resultado neto.',
      'Revisá el gráfico de evolución y el arqueo de cajas.',
      'Exportá a Excel con el botón correspondiente.',
    ],
    campos_obligatorios: [],
    errores_comunes: [],
    palabras_clave: ['informe financiero', 'balance', 'resultado', 'neto', 'ganancia', 'utilidad', 'arqueo', 'financiero'],
    para_que_sirve:
      'Sirve para ver en números cómo le fue al negocio en un período. Reúne ventas, compras, gastos, descuentos, retiros y deuda de clientes, y te muestra el resultado neto. Es la pantalla que te dice si estás ganando o perdiendo, más allá de la plata que entró.',
    que_podes_hacer: [
      'Elegir el período a analizar (día, semana, mes, año o personalizado)',
      'Ver ventas, compras, gastos y el resultado neto',
      'Consultar el gráfico de evolución y el arqueo de cajas',
      'Exportar el informe a Excel',
    ],
  },
  {
    id: 'inteligencia',
    nombre: 'Inteligencia de Negocio',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Inteligencia (admin)',
    prerrequisitos: 'Rol admin. La pestaña Binny requiere el módulo IA.',
    pasos: [
      'Pestaña Stock & Capital Inmovilizado: quiebres y capital parado.',
      'Pestaña Ventas, Tendencias & Pronóstico.',
      'Pestaña Rentabilidad & Pareto (80/20).',
      'Pestaña Auditoría & Anomalías.',
      'Pestañas Informes y Binny (chat analítico).',
    ],
    campos_obligatorios: [],
    errores_comunes: [],
    palabras_clave: ['inteligencia', 'analitica', 'rentabilidad', 'pareto', 'tendencias', 'pronostico', 'anomalias', 'auditoria', 'capital'],
    para_que_sirve:
      'Sirve para analizar el negocio en profundidad y encontrar oportunidades que a simple vista no ves. Detecta quiebres de stock, capital inmovilizado, tendencias de venta y anomalías. Es la pantalla para decidir con datos qué conviene comprar, promocionar o dejar de lado.',
    que_podes_hacer: [
      'Detectar productos con quiebre de stock y capital parado',
      'Ver tendencias de venta y un pronóstico',
      'Analizar qué productos te dejan más ganancia (regla 80/20)',
      'Revisar anomalías y auditar movimientos',
      'Consultar informes y preguntarle a Binny sobre tus números',
    ],
  },
  {
    id: 'usuarios',
    nombre: 'Usuarios y Permisos',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Usuarios (admin)',
    prerrequisitos: 'Rol admin.',
    pasos: [
      'Nuevo Usuario: usuario (mínimo 3 caracteres), contraseña (mínimo 6) y confirmación.',
      'Elegí el rol: admin (total) u operador.',
      'Si es operador, abrí Permisos y marcá los accesos (productos, stock, compras, gastos, clientes, presupuestos).',
      'Cambiar contraseña: desde la fila del usuario.',
    ],
    campos_obligatorios: ['Usuario', 'Contraseña'],
    errores_comunes: ['Las contraseñas deben coincidir y tener al menos 6 caracteres.'],
    palabras_clave: ['usuario', 'usuarios', 'operador', 'permisos', 'rol', 'contrasena', 'clave', 'cajero'],
    para_que_sirve:
      'Sirve para dar acceso al sistema a las personas que trabajan con vos y limitar qué puede hacer cada una. Definís quién es administrador (acceso total) y quién es operador, marcando a qué pantallas puede entrar. Así cada empleado ve solo lo que le corresponde.',
    que_podes_hacer: [
      'Crear un usuario nuevo con su contraseña',
      'Asignar el rol de administrador u operador',
      'Elegir los permisos de cada operador',
      'Cambiar la contraseña de un usuario',
    ],
  },
  {
    id: 'configuracion',
    nombre: 'Configuración (11 pestañas)',
    categoria: 'uso_diario',
    como_se_llega: 'Menú → Configuración (admin)',
    prerrequisitos: 'Rol admin.',
    pasos: [
      'Apariencia: tema claro/oscuro y tamaño de fuente.',
      'Asistente Binny (IA): activar la IA, modelos de voz (Whisper) y TTS, y ver o borrar la memoria de Binny.',
      'Métodos de Pago: habilitar efectivo, débito, crédito, transferencia, Mercado Pago y cuenta corriente (al menos uno).',
      'Comercio e Impresión: datos del negocio y formato del ticket térmico.',
      'Módulos y Catálogo: activar/desactivar los 16 módulos.',
      'Impuestos y Facturación: IVA, alícuotas y desglose.',
      'Balanza y Peso (EAN-13): prefijo y lectura por peso o importe.',
      'Promociones y Descuentos.',
      'Recargos y Delivery.',
      'Copias de Seguridad: crear y restaurar respaldos.',
      'Mantenimiento: ubicación de la base y restablecer (peligroso).',
    ],
    campos_obligatorios: ['Nombre del comercio (en Comercio e Impresión)'],
    errores_comunes: [
      'Debe quedar al menos un medio de pago habilitado.',
      'Mantenimiento/restablecer borra datos: usalo solo con respaldo.',
    ],
    palabras_clave: ['configuracion', 'ajustes', 'apariencia', 'tema', 'metodos de pago', 'modulos', 'impuestos', 'iva', 'balanza', 'respaldos', 'mantenimiento', 'impresora'],
    para_que_sirve:
      'Es el centro de ajustes del sistema: desde acá adaptás el programa a tu negocio. Sirve para definir los medios de pago, los datos del comercio, la impresora, los impuestos, los módulos activos y las copias de seguridad. Es la pantalla que dejás a punto una vez y revisás cuando algo cambia.',
    que_podes_hacer: [
      'Cambiar el tema y el tamaño de la letra',
      'Activar la IA de Binny y sus funciones de voz',
      'Habilitar los medios de pago del negocio',
      'Cargar los datos del comercio y el formato del ticket',
      'Activar o desactivar los módulos del sistema',
      'Configurar impuestos, promociones, recargos, balanza y respaldos',
    ],
  },
  {
    id: 'modulos',
    nombre: 'Módulos del sistema',
    categoria: 'uso_diario',
    como_se_llega: 'Configuración → Módulos y Catálogo',
    prerrequisitos: 'Rol admin.',
    pasos: [
      'Entrá a Configuración → Módulos y Catálogo.',
      'Activá o desactivá cada módulo con su interruptor; se guarda al instante.',
      'Al desactivar se conservan los datos históricos.',
      'Módulos disponibles: Marcas, Categorías, Categorías múltiples, Presentaciones/Packs, IVA/ARCA, Proveedores+Compras, Gastos, Clientes+cta.cte., Presupuestos, Combos, Promociones, Vencimientos, Etiquetas, Recargos, Recordatorios y Balanza EAN-13.',
    ],
    campos_obligatorios: [],
    errores_comunes: ['Algunos módulos dependen de otros (Categorías múltiples requiere Categorías).'],
    palabras_clave: ['modulo', 'modulos', 'activar modulo', 'desactivar modulo', 'habilitar', 'marcas', 'categorias', 'combos', 'iva', 'balanza'],
    para_que_sirve:
      'Sirve para prender o apagar las funciones del sistema según lo que uses. Si no necesitás, por ejemplo, proveedores o promociones, los desactivás y esas pantallas dejan de aparecer. Es la forma de dejar el programa simple, con solo lo que tu negocio usa.',
    que_podes_hacer: [
      'Activar los módulos que querés usar',
      'Desactivar los que no necesitás',
      'Consultar qué módulos están disponibles',
      'Volver a activar un módulo cuando lo necesites',
    ],
  },
  {
    id: 'promociones',
    nombre: 'Promociones y Descuentos',
    categoria: 'uso_diario',
    como_se_llega: 'Configuración → Promociones y Descuentos (módulo Promociones)',
    prerrequisitos: 'Módulo Promociones activo.',
    pasos: [
      'Nueva Promoción.',
      'Poné nombre y prioridad.',
      'Elegí las condiciones (día, medio de pago, monto mínimo, productos, cantidad mínima).',
      'Elegí el efecto: % de descuento, monto fijo, lleva_x_paga_y o 2da unidad.',
      'Activá la promoción.',
    ],
    campos_obligatorios: ['Nombre'],
    errores_comunes: ['Se aplican solas en el POS según la prioridad.'],
    palabras_clave: ['promocion', 'promociones', 'descuento', '2x1', '3x2', 'lleva', 'oferta'],
    para_que_sirve:
      'Sirve para crear descuentos y ofertas que se aplican solas en el Punto de Venta. Definís las condiciones (por día, por medio de pago, por monto o por producto) y el sistema las calcula al cobrar. Es la pantalla para armar promos sin que el cajero tenga que recordarlas.',
    que_podes_hacer: [
      'Crear una promoción con sus condiciones',
      'Elegir el tipo de descuento (porcentaje, monto fijo, 2x1 o segunda unidad)',
      'Definir prioridad entre varias promociones',
      'Activar o desactivar una promoción',
    ],
  },
  {
    id: 'recargos',
    nombre: 'Recargos y Delivery',
    categoria: 'uso_diario',
    como_se_llega: 'Configuración → Recargos y Delivery (módulo Recargos)',
    prerrequisitos: 'Módulo Recargos activo.',
    pasos: ['Nuevo Recargo.', 'Nombre, tipo (fijo o porcentaje) y valor.', 'Activá el recargo.', 'En el POS se agrega con Ctrl+E.'],
    campos_obligatorios: ['Nombre', 'Valor'],
    errores_comunes: [],
    palabras_clave: ['recargo', 'recargos', 'delivery', 'envio', 'flete', 'adicional'],
    para_que_sirve:
      'Sirve para cobrar adicionales, como un recargo por tarjeta o un cargo por envío a domicilio. Cargás el recargo una vez y después lo agregás a la venta con un atajo. Es útil para trasladar al cliente el costo del delivery o de ciertos pagos.',
    que_podes_hacer: [
      'Crear un recargo fijo o por porcentaje',
      'Activar o desactivar un recargo',
      'Aplicar el recargo a una venta desde el POS',
    ],
  },
  {
    id: 'recordatorios',
    nombre: 'Recordatorios',
    categoria: 'uso_diario',
    como_se_llega: 'Campana (🔔) en la barra superior → Nuevo Recordatorio',
    prerrequisitos: 'Módulo Recordatorios activo.',
    pasos: [
      'Tocá la campana de la barra superior.',
      'Nuevo Recordatorio: título, fecha, hora y sonido (sound_01 a sound_05 o silencio).',
      'Guardar.',
      'Desde la lista podés completar, posponer, reabrir o eliminar.',
    ],
    campos_obligatorios: ['Título', 'Fecha', 'Hora'],
    errores_comunes: ['Sin el módulo Recordatorios no aparece la campana.'],
    palabras_clave: ['recordatorio', 'recordatorios', 'alarma', 'aviso', 'campana', 'recordame'],
    para_que_sirve:
      'Sirve para no olvidarte de nada importante del negocio: pagar un vencimiento, hacer un pedido, llamar a un cliente. Cargás el aviso con fecha y hora, y el sistema te lo recuerda con un sonido. Es tu agenda liviana dentro del sistema.',
    que_podes_hacer: [
      'Crear un recordatorio con título, fecha y hora',
      'Elegir el sonido del aviso',
      'Marcar un recordatorio como completado',
      'Posponer o reabrir un recordatorio',
      'Eliminar un recordatorio',
    ],
  },
  {
    id: 'paleta',
    nombre: 'Paleta de comandos y atajos',
    categoria: 'uso_diario',
    como_se_llega: 'Ctrl+K en cualquier pantalla; F1 abre los atajos del POS',
    prerrequisitos: 'Sesión iniciada.',
    pasos: [
      'Paleta de comandos: Ctrl+K, escribí una vista o acción (ej: pos, gastos, clientes) y Enter.',
      'Atajos del POS: F1 muestra la guía; F2 buscar, F3 cliente, F4 vuelto, F5-F9 medios de pago, F10 cobrar, F12 cobrar e imprimir, F11 kiosko, Ctrl+D descuento, Ctrl+E recargo, Ctrl+T nueva venta, Ctrl+W cerrar venta, Ctrl+Supr vaciar carrito, Ctrl+B colapsar menú.',
    ],
    campos_obligatorios: [],
    errores_comunes: [],
    palabras_clave: ['atajo', 'atajos', 'paleta', 'comandos', 'ctrl+k', 'teclado', 'shortcut', 'f1'],
    para_que_sirve:
      'Sirve para moverte rápido por el sistema sin usar el menú. Con un atajo abrís una vista o una acción, y en el Punto de Venta tenés teclas para cobrar casi sin tocar el mouse. Es la pantalla que te ahorra tiempo cuando ya conocés el programa.',
    que_podes_hacer: [
      'Abrir cualquier pantalla escribiendo su nombre',
      'Consultar todos los atajos de teclado del POS',
      'Cobrar y buscar productos sin usar el mouse',
    ],
  },
  {
    id: 'activacion',
    nombre: 'Activación / Licencia',
    categoria: 'primeros_pasos',
    como_se_llega: 'Pantalla de activación al iniciar sin licencia',
    prerrequisitos: 'La app detecta que no hay licencia activa.',
    pasos: ['Al abrir sin licencia aparece Activación.', 'Pegá la clave de licencia y activá.', 'El sistema valida y guarda la activación.'],
    campos_obligatorios: ['Clave de licencia'],
    errores_comunes: ['Si la licencia no está activa o la instalación no coincide, da error.'],
    palabras_clave: ['licencia', 'activacion', 'activar', 'clave', 'sin licencia'],
    para_que_sirve:
      'Sirve para habilitar el sistema con tu licencia la primera vez que lo instalás. Sin activar, el programa queda bloqueado; con la clave cargada, ya podés empezar a usarlo. Es un paso que se hace una sola vez.',
    que_podes_hacer: [
      'Ingresar la clave de licencia',
      'Activar el sistema en esta instalación',
      'Dejar el programa habilitado para trabajar',
    ],
  },
  {
    id: 'crear_admin',
    nombre: 'Crear administrador',
    categoria: 'primeros_pasos',
    como_se_llega: 'Pantalla Crear Administrador (primer arranque)',
    prerrequisitos: 'No existe todavía un usuario administrador.',
    pasos: [
      'Al no existir un admin, aparece Crear Administrador.',
      'Ingresá usuario (mínimo 3), contraseña (mínimo 6) y confirmación.',
      'Creá el administrador.',
    ],
    campos_obligatorios: ['Usuario', 'Contraseña'],
    errores_comunes: ['Las contraseñas deben coincidir.'],
    palabras_clave: ['crear admin', 'administrador', 'primer admin', 'usuario admin'],
    para_que_sirve:
      'Sirve para crear el primer usuario del sistema, el administrador, la primera vez que arrancás. Ese usuario tiene acceso total y desde él después vas a crear los demás. Es el punto de partida para poder entrar al sistema.',
    que_podes_hacer: [
      'Crear el usuario administrador con su contraseña',
      'Definir las credenciales de acceso iniciales',
      'Dejar listo el primer acceso al sistema',
    ],
  },
  {
    id: 'instalacion',
    nombre: 'Asistente de instalación',
    categoria: 'primeros_pasos',
    como_se_llega: 'Primer inicio de sesión tras crear el admin',
    prerrequisitos: 'Ya existe un administrador y el setup inicial no está completado.',
    pasos: [
      'Paso 1: elegí los métodos de pago (al menos uno).',
      'Paso 2: formato de impresora y datos del ticket.',
      'Paso 3: estructura del catálogo (marcas, categorías, presentaciones).',
      'Paso 4: módulos operativos (IVA, proveedores, gastos, clientes, etc.).',
      'Finalizá; todo se puede cambiar después en Configuración.',
    ],
    campos_obligatorios: ['Al menos un método de pago'],
    errores_comunes: ['No podés avanzar del paso 1 sin un método de pago.'],
    palabras_clave: ['asistente', 'instalacion', 'primeros pasos', 'setup', 'configuracion inicial'],
    para_que_sirve:
      'Sirve para dejar el sistema configurado a tu medida en el primer uso, sin tener que ir pestaña por pestaña. Te guía por los medios de pago, la impresora, el catálogo y los módulos. Todo lo que elegís acá se puede cambiar después en Configuración.',
    que_podes_hacer: [
      'Elegir los medios de pago del negocio',
      'Configurar la impresora y los datos del ticket',
      'Definir la estructura del catálogo',
      'Elegir los módulos que vas a usar',
    ],
  },
  {
    id: 'login',
    nombre: 'Inicio de sesión',
    categoria: 'primeros_pasos',
    como_se_llega: 'Pantalla de login (tras el setup inicial)',
    prerrequisitos: 'Setup inicial completado.',
    pasos: ['Ingresá usuario y contraseña.', 'Entrá; si el usuario es operador verá solo sus accesos.'],
    campos_obligatorios: ['Usuario', 'Contraseña'],
    errores_comunes: ['Con credenciales incorrectas no se puede entrar.'],
    palabras_clave: ['login', 'iniciar sesion', 'entrar', 'usuario', 'contrasena'],
    para_que_sirve:
      'Es la puerta de entrada al sistema: sirve para identificarte con tu usuario y contraseña. Según quién entres, vas a ver todas las pantallas o solo las que te corresponden. Es el paso diario antes de empezar a trabajar.',
    que_podes_hacer: [
      'Entrar al sistema con usuario y contraseña',
      'Acceder solo a las pantallas de tu rol',
      'Cerrar la sesión para que otro usuario entre',
    ],
  },
  {
    id: 'binny',
    nombre: 'Asistente Binny (chat)',
    categoria: 'uso_diario',
    como_se_llega: 'Burbuja de Binny o Configuración → Asistente Binny',
    prerrequisitos: 'Módulo IA activo y cuota mensual disponible.',
    pasos: [
      'Abrí el chat de Binny (burbuja flotante).',
      'Preguntá en lenguaje natural sobre tu negocio o sobre cómo hacer algo en la app.',
      'Usá el micrófono para dictar (Whisper) y el parlante para escuchar (TTS).',
      'En Configuración → Asistente Binny activás la IA, los modelos de voz y ves o borrás su memoria.',
    ],
    campos_obligatorios: [],
    errores_comunes: ['Sin cuota mensual disponible, Binny no responde.'],
    palabras_clave: ['binny', 'asistente', 'chat', 'ia', 'voz', 'whisper', 'tts', 'memoria'],
    para_que_sirve:
      'Sirve para hacerle preguntas al sistema en lenguaje normal, como si le hablaras a una persona. Podés preguntarle cómo hacer algo en la app o pedirle un análisis de tus números, y te responde al instante. Es como tener un ayudante que conoce tu negocio y el programa.',
    que_podes_hacer: [
      'Preguntar cómo hacer algo en el sistema',
      'Pedirle un análisis o un consejo sobre tu negocio',
      'Dictarle por micrófono y escuchar sus respuestas',
      'Borrar o revisar lo que Binny recuerda',
    ],
  },
  {
    id: 'respaldos',
    nombre: 'Copias de Seguridad (Respaldos)',
    categoria: 'uso_diario',
    como_se_llega: 'Configuración → Copias de Seguridad',
    prerrequisitos: 'En la PC servidor, con rol admin.',
    pasos: [
      'Entrá a Configuración → Copias de Seguridad.',
      'Crear Respaldo, poné una descripción.',
      'El archivo .db.zst queda guardado; desde acá podés restaurar.',
    ],
    campos_obligatorios: [],
    errores_comunes: ['Restaurar reemplaza la base actual.'],
    palabras_clave: ['respaldo', 'respaldos', 'copia de seguridad', 'backup', 'restaurar'],
    para_que_sirve:
      'Sirve para proteger tu información: guarda una copia de todos los datos del negocio en un archivo. Si algo sale mal (un error o un problema en la PC), podés volver atrás y recuperar todo. Es el seguro que conviene tener al día.',
    que_podes_hacer: [
      'Crear una copia de seguridad de tus datos',
      'Guardar la copia con una descripción',
      'Restaurar el sistema a una copia anterior',
    ],
  },
  {
    id: 'ayuda',
    nombre: 'Ayuda (manual del sistema)',
    categoria: 'primeros_pasos',
    como_se_llega: 'Menú → Ayuda',
    prerrequisitos: 'Sesión iniciada. Disponible para cualquier rol.',
    pasos: [
      'Entrá a Ayuda desde el menú lateral.',
      'Elegí una pantalla de la lista, o escribí en el buscador (por ejemplo "cobrar" o "stock").',
      'Abrí la explicación: para qué sirve, cómo se llega, los pasos y las fotos.',
      'Tocá una imagen para verla en grande; con "Tamaño real" la ves al 100%.',
    ],
    campos_obligatorios: [],
    errores_comunes: [
      'Si una búsqueda no devuelve nada, probá con el nombre de la pantalla o con la tarea ("caja", "compras", "cliente").',
    ],
    palabras_clave: ['ayuda', 'faq', 'guia', 'manual', 'tutorial', 'explicacion'],
    para_que_sirve:
      'Es tu manual a mano: explica cada pantalla del sistema en lenguaje simple, con fotos reales de cómo se ve. Sirve cuando no sabés cómo hacer algo, o cuando querés descubrir todo lo que el sistema puede hacer por vos. Funciona sin internet.',
    que_podes_hacer: [
      'Buscar una pantalla o una tarea por palabra',
      'Leer para qué sirve cada pantalla y qué podés hacer ahí',
      'Seguir el paso a paso con fotos de cada pantalla',
      'Ampliar las imágenes para ver el detalle',
    ],
  },
];

/** Índice compacto: una línea por pantalla con su camino. Presupuesto ≤ 2.000 chars. */
export const INDICE_MANUAL: string = MANUAL_ENTRADAS.map(
  (e) => `- ${e.nombre}: ${e.como_se_llega}`,
).join('\n');

/** Normaliza texto para el match: minúsculas y sin acentos. */
function normalizar(texto: string): string {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const REGEX_ESPECIALES = /[.*+?^${}()|[\]\\]/g;

/** ¿La palabra clave aparece en la pregunta (como palabra completa o frase)? */
function coincide(preguntaNorm: string, clave: string): boolean {
  const claveNorm = normalizar(clave).trim();
  if (!claveNorm) return false;
  if (claveNorm.includes(' ')) return preguntaNorm.includes(claveNorm);
  return new RegExp(`(^|[^a-z0-9])${claveNorm.replace(REGEX_ESPECIALES, '\\$&')}([^a-z0-9]|$)`).test(preguntaNorm);
}

/** Puntaje de una entrada contra la pregunta: frases pesan más que palabras sueltas. */
function puntuar(entrada: EntradaManual, preguntaNorm: string): number {
  let score = 0;
  for (const clave of entrada.palabras_clave) {
    if (coincide(preguntaNorm, clave)) {
      score += clave.includes(' ') ? 3 : 2;
    }
  }
  if (coincide(preguntaNorm, entrada.nombre)) score += 1;
  return score;
}

function formatearEntrada(e: EntradaManual): string {
  const lineas = [`### ${e.nombre}`, `Cómo se llega: ${e.como_se_llega}`];
  if (e.prerrequisitos) lineas.push(`Prerrequisitos: ${e.prerrequisitos}`);
  if (e.pasos.length > 0) lineas.push(`Pasos: ${e.pasos.map((p, i) => `${i + 1}) ${p}`).join(' ')}`);
  if (e.campos_obligatorios.length > 0) lineas.push(`Campos obligatorios: ${e.campos_obligatorios.join(', ')}.`);
  if (e.errores_comunes.length > 0) lineas.push(`Errores comunes: ${e.errores_comunes.join(' ')}`);
  return lineas.join('\n');
}

export const MANUAL_MAX_ENTRADAS = 3;
export const MANUAL_MAX_DETALLE_CHARS = 6000;

/**
 * Recuperación determinística: puntúa cada entrada por las palabras clave de la
 * pregunta y devuelve hasta 3 entradas (≤ 6.000 chars en total). Si no hay
 * coincidencias, devuelve cadena vacía (el llamador inyecta solo el índice).
 */
export function recuperarDetalleManual(pregunta: string): string {
  const preguntaNorm = normalizar(pregunta);
  if (!preguntaNorm.trim()) return '';
  const puntuadas = MANUAL_ENTRADAS.map((entrada) => ({ entrada, score: puntuar(entrada, preguntaNorm) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const bloques: string[] = [];
  let total = 0;
  for (const { entrada } of puntuadas) {
    if (bloques.length >= MANUAL_MAX_ENTRADAS) break;
    const bloque = formatearEntrada(entrada);
    if (total + bloque.length > MANUAL_MAX_DETALLE_CHARS) break;
    bloques.push(bloque);
    total += bloque.length + 2;
  }
  return bloques.join('\n\n');
}

/**
 * Manual completo para inyectar en el prompt: el índice SIEMPRE y, si la
 * pregunta del comerciante matchea palabras clave, el detalle de 1 a 3 pantallas.
 */
export function construirManual(pregunta = ''): string {
  const detalle = recuperarDetalleManual(pregunta);
  const partes = ['## Manual de la interfaz (índice de pantallas)', INDICE_MANUAL];
  if (detalle) {
    partes.push('', '## Detalle de las pantallas relacionadas con la pregunta', detalle);
  }
  return partes.join('\n');
}
