/**
 * Manual estructurado de la interfaz (Binny modo guía).
 *
 * Binny dejó de crear/modificar datos del negocio y pasó a ser un guía de la
 * interfaz. Este archivo es su única fuente de verdad sobre las pantallas: cada
 * entrada describe nombre visible, cómo se llega (menú → submenú → pestaña),
 * prerrequisitos, pasos numerados, campos obligatorios, errores comunes y
 * palabras clave para la recuperación determinística.
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
}

export const MANUAL_ENTRADAS: EntradaManual[] = [
  {
    id: 'dashboard',
    nombre: 'Dashboard (Inicio)',
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
  },
  {
    id: 'wizard',
    nombre: 'Wizard de bienvenida',
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
  },
  {
    id: 'pos',
    nombre: 'Punto de Venta (POS)',
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
  },
  {
    id: 'pos_extras',
    nombre: 'POS: descuentos, espera, kiosko y balanza',
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
  },
  {
    id: 'caja',
    nombre: 'Caja',
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
  },
  {
    id: 'inventario',
    nombre: 'Inventario',
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
  },
  {
    id: 'productos',
    nombre: 'Productos',
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
  },
  {
    id: 'combos',
    nombre: 'Combos / Kits',
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
  },
  {
    id: 'categorias',
    nombre: 'Categorías',
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
  },
  {
    id: 'marcas',
    nombre: 'Marcas',
    como_se_llega: 'Menú → Marcas (sección Administración, admin)',
    prerrequisitos: 'Módulo Marcas activo.',
    pasos: ['Nueva Marca.', 'Escribí el Nombre y Guardar.', 'Activá/desactivá una marca con su interruptor.'],
    campos_obligatorios: ['Nombre'],
    errores_comunes: [],
    palabras_clave: ['marca', 'marcas', 'fabricante'],
  },
  {
    id: 'unidades',
    nombre: 'Unidades de medida',
    como_se_llega: 'Menú → Unidades (sección Administración, admin)',
    prerrequisitos: 'Rol admin.',
    pasos: ['Nueva Unidad.', 'Completá la Abreviatura (ej: un., kg, L) y, si querés, el Nombre.', 'Guardar.'],
    campos_obligatorios: ['Abreviatura'],
    errores_comunes: ['La unidad "Unidades" (id 1) viene por defecto.'],
    palabras_clave: ['unidad', 'unidades', 'medida', 'kilo', 'litro', 'abreviatura'],
  },
  {
    id: 'compras',
    nombre: 'Compras',
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
  },
  {
    id: 'proveedores',
    nombre: 'Proveedores',
    como_se_llega: 'Menú → Proveedores (admin, módulo Proveedores)',
    prerrequisitos: 'Módulo Proveedores activo.',
    pasos: ['Nuevo Proveedor.', 'Completá el Nombre (único obligatorio).', 'Opcional: teléfono, email, dirección y nota.', 'Guardar.'],
    campos_obligatorios: ['Nombre'],
    errores_comunes: ['Un proveedor NO es un cliente: los clientes se cargan en Clientes.'],
    palabras_clave: ['proveedor', 'proveedores', 'distribuidor', 'mayorista'],
  },
  {
    id: 'gastos',
    nombre: 'Gastos',
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
  },
  {
    id: 'clientes',
    nombre: 'Clientes',
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
  },
  {
    id: 'presupuestos',
    nombre: 'Presupuestos',
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
  },
  {
    id: 'informe',
    nombre: 'Informe Financiero',
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
  },
  {
    id: 'inteligencia',
    nombre: 'Inteligencia de Negocio',
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
  },
  {
    id: 'usuarios',
    nombre: 'Usuarios y Permisos',
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
  },
  {
    id: 'configuracion',
    nombre: 'Configuración (11 pestañas)',
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
  },
  {
    id: 'modulos',
    nombre: 'Módulos del sistema',
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
  },
  {
    id: 'promociones',
    nombre: 'Promociones y Descuentos',
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
  },
  {
    id: 'recargos',
    nombre: 'Recargos y Delivery',
    como_se_llega: 'Configuración → Recargos y Delivery (módulo Recargos)',
    prerrequisitos: 'Módulo Recargos activo.',
    pasos: ['Nuevo Recargo.', 'Nombre, tipo (fijo o porcentaje) y valor.', 'Activá el recargo.', 'En el POS se agrega con Ctrl+E.'],
    campos_obligatorios: ['Nombre', 'Valor'],
    errores_comunes: [],
    palabras_clave: ['recargo', 'recargos', 'delivery', 'envio', 'flete', 'adicional'],
  },
  {
    id: 'recordatorios',
    nombre: 'Recordatorios',
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
  },
  {
    id: 'paleta',
    nombre: 'Paleta de comandos y atajos',
    como_se_llega: 'Ctrl+K en cualquier pantalla; F1 abre los atajos del POS',
    prerrequisitos: 'Sesión iniciada.',
    pasos: [
      'Paleta de comandos: Ctrl+K, escribí una vista o acción (ej: pos, gastos, clientes) y Enter.',
      'Atajos del POS: F1 muestra la guía; F2 buscar, F3 cliente, F4 vuelto, F5-F9 medios de pago, F10 cobrar, F12 cobrar e imprimir, F11 kiosko, Ctrl+D descuento, Ctrl+E recargo, Ctrl+T nueva venta, Ctrl+W cerrar venta, Ctrl+Supr vaciar carrito, Ctrl+B colapsar menú.',
    ],
    campos_obligatorios: [],
    errores_comunes: [],
    palabras_clave: ['atajo', 'atajos', 'paleta', 'comandos', 'ctrl+k', 'teclado', 'shortcut', 'f1'],
  },
  {
    id: 'activacion',
    nombre: 'Activación / Licencia',
    como_se_llega: 'Pantalla de activación al iniciar sin licencia',
    prerrequisitos: 'La app detecta que no hay licencia activa.',
    pasos: ['Al abrir sin licencia aparece Activación.', 'Pegá la clave de licencia y activá.', 'El sistema valida y guarda la activación.'],
    campos_obligatorios: ['Clave de licencia'],
    errores_comunes: ['Si la licencia no está activa o la instalación no coincide, da error.'],
    palabras_clave: ['licencia', 'activacion', 'activar', 'clave', 'sin licencia'],
  },
  {
    id: 'crear_admin',
    nombre: 'Crear administrador',
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
  },
  {
    id: 'instalacion',
    nombre: 'Asistente de instalación',
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
  },
  {
    id: 'login',
    nombre: 'Inicio de sesión',
    como_se_llega: 'Pantalla de login (tras el setup inicial)',
    prerrequisitos: 'Setup inicial completado.',
    pasos: ['Ingresá usuario y contraseña.', 'Entrá; si el usuario es operador verá solo sus accesos.'],
    campos_obligatorios: ['Usuario', 'Contraseña'],
    errores_comunes: ['Con credenciales incorrectas no se puede entrar.'],
    palabras_clave: ['login', 'iniciar sesion', 'entrar', 'usuario', 'contrasena'],
  },
  {
    id: 'binny',
    nombre: 'Asistente Binny (chat)',
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
  },
  {
    id: 'respaldos',
    nombre: 'Copias de Seguridad (Respaldos)',
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
