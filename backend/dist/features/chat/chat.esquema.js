export const ESQUEMA_SQLITE = `
# Base de datos SQLite del POS - Estructura completa

Las fechas (creado_en, actualizado_en, vence_en, etc.) son timestamps Unix en segundos (INTEGER).
Los precios y montos son números reales (REAL).
Los IDs son INTEGER autoincrement.

## Relaciones de negocio
- Un POS (servidor) tiene UNA licencia con UN comercio.
- Los productos se organizan por unidad, marca (opcional), categoría (opcional, múltiple opcional).
- Las ventas se asocian a un turno de caja activo y opcionalmente a un cliente.
- Los clientes tienen cuenta corriente con movimientos (saldo anterior/posterior).
- Las compras registran stock y se asocian a proveedores.
- Los gastos se categorizan y pueden asociarse a un turno de caja o una compra.
- Los presupuestos pueden convertirse en ventas.
- Los combos agrupan productos con precio especial.
- Las promociones aplican descuentos por condiciones (monto, producto, cantidad).
- Los recargos se aplican sobre subtotales de venta.
- Los vencimientos rastrean fechas de expiración de productos por lote.

## Glosario
- "turno_caja": Sesión de caja de un cajero. Puede estar abierto o cerrado.
- "venta": Transacción de venta. estados: "abierta", "pagada", "anulada".
- "venta_pago": Medios de pago de una venta (efectivo, débito, etc.).
- "compra": Registro de compra a proveedor. Impacta stock.
- "gasto": Gasto operativo del negocio (no impacta stock).
- "presupuesto": Cotización que puede o no convertirse en venta.
- "movimiento_stock": Cada entrada/salida de stock de un producto.
- "cliente_movimiento_cuenta": Asientos de cuenta corriente del cliente.
- "historial_precio": Registro de cambios de precio de venta de un producto.
- "presentacion_compra": Empaque de compra (ej: caja de 12 unidades).
- "combo_item": Producto dentro de un combo con precio unitario especial.
- "promocion": Regla de descuento con condiciones_json y efectivos_json.
- "recargo": Cargo adicional aplicable a ventas (ej: tarjeta de crédito).

## Tablas

### licencia
Clave de licencia del POS, datos del comercio y estado.
- id INTEGER PK
- licencia_servidor_id TEXT NOT NULL
- clave TEXT NOT NULL
- comercio_id TEXT NOT NULL
- comercio_nombre TEXT NOT NULL
- instalacion_id TEXT NOT NULL
- estado TEXT NOT NULL (valores: "activa", "suspendida")
- rol TEXT NOT NULL
- ultima_validacion INTEGER NOT NULL
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### usuario
Usuarios del POS (admin o cajero/vendedor).
- id INTEGER PK
- usuario TEXT NOT NULL UNIQUE
- password_hash TEXT NOT NULL
- rol TEXT NOT NULL (valores: "admin", "vendedor")
- activo INTEGER NOT NULL DEFAULT 1
- permisos TEXT (JSON string: {verArqueoEnVivo, cerrarCaja, cancelarVentaCarrito, verHistorialTurnos, accesoProductos, accesoStock, accesoCompras, accesoGastos, accesoClientes, accesoPresupuestos, accesoProveedores})
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### config
Pares clave-valor de configuración del POS.
- clave TEXT PK
- valor TEXT NOT NULL
- actualizado_en INTEGER NOT NULL

### unidad
Unidades de medida (un, kg, lt, etc.).
- id INTEGER PK
- abreviatura TEXT NOT NULL
- nombre TEXT NOT NULL
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### marca
Marcas de productos.
- id INTEGER PK
- nombre TEXT NOT NULL
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### categoria
Categorías de productos.
- id INTEGER PK
- nombre TEXT NOT NULL
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### producto
Catálogo de productos.
- id INTEGER PK
- codigo_barras TEXT (UNIQUE)
- codigo_interno TEXT (UNIQUE)
- nombre TEXT NOT NULL
- descripcion TEXT
- precio_venta REAL NOT NULL
- precio_costo REAL NOT NULL DEFAULT 0
- cantidad REAL NOT NULL DEFAULT 0
- stock_minimo REAL NOT NULL DEFAULT 0
- unidad_id INTEGER NOT NULL FK -> unidad
- marca_id INTEGER FK -> marca (nullable)
- permitir_sin_stock INTEGER NOT NULL DEFAULT 0
- fecha_vencimiento INTEGER (nullable, unix timestamp)
- lote TEXT (nullable)
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### producto_categoria
Relación muchos a muchos producto-categoría.
- producto_id INTEGER NOT NULL FK -> producto ON DELETE CASCADE
- categoria_id INTEGER NOT NULL FK -> categoria ON DELETE CASCADE
PK: (producto_id, categoria_id)

### historial_precio
Registro de cambios de precio de venta de productos.
- id INTEGER PK
- producto_id INTEGER NOT NULL FK -> producto
- precio_anterior REAL NOT NULL
- precio_nuevo REAL NOT NULL
- creado_en INTEGER NOT NULL

### movimiento_stock
Entradas y salidas de stock.
- id INTEGER PK
- producto_id INTEGER NOT NULL FK -> producto
- tipo TEXT NOT NULL ("entrada", "salida", "ajuste", "compra", "venta")
- cantidad REAL NOT NULL
- motivo TEXT
- usuario_id INTEGER FK -> usuario
- compra_id INTEGER FK -> compra (nullable)
- creado_en INTEGER NOT NULL

### proveedor
Proveedores del negocio.
- id INTEGER PK
- nombre TEXT NOT NULL
- telefono TEXT
- email TEXT
- direccion TEXT
- notas TEXT
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### compra
Compras a proveedores. Impacta stock.
- id INTEGER PK
- proveedor_id INTEGER FK -> proveedor
- usuario_id INTEGER NOT NULL FK -> usuario
- total REAL NOT NULL DEFAULT 0
- notas TEXT
- estado TEXT NOT NULL ("abierta", "cerrada", "anulada")
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### compra_item
Items de una compra.
- id INTEGER PK
- compra_id INTEGER NOT NULL FK -> compra ON DELETE CASCADE
- producto_id INTEGER NOT NULL FK -> producto
- cantidad REAL NOT NULL
- precio_unitario REAL NOT NULL
- subtotal REAL NOT NULL
- unidad_abreviatura TEXT (nullable)
- cantidad_presentacion REAL (nullable)
- precio_presentacion REAL (nullable)
- actualiza_costo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### presentacion_compra
Empaques de compra (ej: caja de 12 unidades).
- id INTEGER PK
- nombre TEXT NOT NULL
- cantidad REAL NOT NULL
- precio_referencia REAL NOT NULL DEFAULT 0
- proveedor_id INTEGER FK -> proveedor
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### gasto
Gastos operativos del negocio.
- id INTEGER PK
- categoria_gasto_id INTEGER NOT NULL FK -> categoria_gasto
- turno_caja_id INTEGER FK -> turno_caja (nullable)
- compra_id INTEGER FK -> compra (nullable)
- monto REAL NOT NULL
- descripcion TEXT
- fecha INTEGER NOT NULL
- usuario_id INTEGER NOT NULL FK -> usuario
- estado TEXT NOT NULL ("activo", "anulado")
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### categoria_gasto
Categorías de gastos (alquiler, sueldos, servicios, etc.).
- id INTEGER PK
- nombre TEXT NOT NULL
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### cliente
Clientes del negocio con cuenta corriente.
- id INTEGER PK
- nombre TEXT NOT NULL
- documento TEXT
- condicion_iva TEXT NOT NULL DEFAULT "consumidor_final"
- telefono TEXT
- email TEXT
- direccion TEXT
- limite_credito REAL NOT NULL DEFAULT 0
- saldo_actual REAL NOT NULL DEFAULT 0
- notas TEXT
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### cliente_movimiento_cuenta
Asientos de cuenta corriente del cliente.
- id INTEGER PK
- cliente_id INTEGER NOT NULL FK -> cliente ON DELETE CASCADE
- tipo TEXT NOT NULL ("credito", "debito", "pago")
- monto REAL NOT NULL
- saldo_anterior REAL NOT NULL
- saldo_posterior REAL NOT NULL
- descripcion TEXT
- venta_id INTEGER FK -> venta (nullable)
- usuario_id INTEGER NOT NULL FK -> usuario
- creado_en INTEGER NOT NULL

### turno_caja
Sesiones de caja (abrir/cerrar).
- id INTEGER PK
- usuario_id INTEGER NOT NULL FK -> usuario
- monto_inicial REAL NOT NULL DEFAULT 0
- monto_esperado REAL NOT NULL DEFAULT 0
- monto_real REAL (nullable, se llena al cerrar)
- estado TEXT NOT NULL ("abierto", "cerrado")
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### caja_retiro
Retiros de efectivo del turno de caja.
- id INTEGER PK
- turno_caja_id INTEGER NOT NULL FK -> turno_caja
- monto REAL NOT NULL
- descripcion TEXT
- usuario_id INTEGER NOT NULL FK -> usuario
- autorizado_por_usuario_id INTEGER FK -> usuario (nullable)
- creado_en INTEGER NOT NULL

### venta
Ventas del negocio.
- id INTEGER PK
- turno_caja_id INTEGER NOT NULL FK -> turno_caja
- cliente_id INTEGER FK -> cliente (nullable)
- descuento REAL NOT NULL DEFAULT 0
- recargo REAL NOT NULL DEFAULT 0
- total REAL NOT NULL DEFAULT 0
- estado TEXT NOT NULL ("abierta", "pagada", "anulada")
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### venta_item
Items de una venta.
- id INTEGER PK
- venta_id INTEGER NOT NULL FK -> venta ON DELETE CASCADE
- producto_id INTEGER NOT NULL FK -> producto
- cantidad REAL NOT NULL
- precio_unitario REAL NOT NULL
- subtotal REAL NOT NULL
- descuento_item REAL NOT NULL DEFAULT 0
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### venta_pago
Medios de pago de una venta.
- id INTEGER PK
- venta_id INTEGER NOT NULL FK -> venta ON DELETE CASCADE
- metodo TEXT NOT NULL ("efectivo", "debito", "credito", "transferencia", "mercado_pago", "cuenta_corriente")
- monto REAL NOT NULL
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### presupuesto
Cotizaciones/presupuestos.
- id INTEGER PK
- cliente_nombre TEXT
- cliente_documento TEXT
- total REAL NOT NULL DEFAULT 0
- estado TEXT NOT NULL ("borrador", "enviado", "aprobado", "rechazado", "convertido")
- notas TEXT
- usuario_id INTEGER NOT NULL FK -> usuario
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### presupuesto_item
Items de un presupuesto.
- id INTEGER PK
- presupuesto_id INTEGER NOT NULL FK -> presupuesto ON DELETE CASCADE
- producto_id INTEGER NOT NULL FK -> producto
- cantidad REAL NOT NULL
- precio_unitario REAL NOT NULL
- subtotal REAL NOT NULL
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### combo
Combos de productos con precio especial.
- id INTEGER PK
- nombre TEXT NOT NULL
- precio_venta REAL NOT NULL
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### combo_item
Productos dentro de un combo.
- id INTEGER PK
- combo_id INTEGER NOT NULL FK -> combo ON DELETE CASCADE
- producto_id INTEGER NOT NULL FK -> producto
- cantidad REAL NOT NULL
- precio_unitario REAL NOT NULL
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### promocion
Reglas de descuento.
- id INTEGER PK
- nombre TEXT NOT NULL
- tipo TEXT NOT NULL ("descuento_porcentaje", "descuento_monto", "2x1", "3x2")
- condiciones_json TEXT NOT NULL (JSON: [{tipo, valor}])
- efectivos_json TEXT NOT NULL (JSON: [{tipo, valor}])
- fecha_desde INTEGER (nullable)
- fecha_hasta INTEGER (nullable)
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL

### recargo
Cargos adicionales aplicables a ventas (ej: recargo por tarjeta de crédito).
- id INTEGER PK
- nombre TEXT NOT NULL
- porcentaje REAL NOT NULL
- activo INTEGER NOT NULL DEFAULT 1
- creado_en INTEGER NOT NULL
- actualizado_en INTEGER NOT NULL
`;
export const EJEMPLOS_CONSULTAS = [
    {
        pregunta: '¿Cuánto facturé hoy?',
        sql: `SELECT SUM(total) AS total_hoy FROM venta WHERE estado = 'pagada' AND DATE(creado_en, 'unixepoch', 'localtime') = DATE('now', 'localtime') LIMIT 1`,
    },
    {
        pregunta: '¿Cuáles son los productos con stock bajo el mínimo?',
        sql: `SELECT p.nombre, p.cantidad, p.stock_minimo, u.abreviatura FROM producto p JOIN unidad u ON u.id = p.unidad_id WHERE p.cantidad <= p.stock_minimo AND p.activo = 1 ORDER BY p.cantidad ASC LIMIT 50`,
    },
    {
        pregunta: '¿Quién es el cliente que más debe?',
        sql: `SELECT nombre, documento, saldo_actual FROM cliente WHERE saldo_actual > 0 AND activo = 1 ORDER BY saldo_actual DESC LIMIT 10`,
    },
    {
        pregunta: '¿Cuánto gasté en alquiler este mes?',
        sql: `SELECT SUM(g.monto) AS total FROM gasto g JOIN categoria_gasto cg ON cg.id = g.categoria_gasto_id WHERE cg.nombre LIKE '%alquiler%' AND g.estado = 'activo' AND g.fecha >= (strftime('%s', 'now', 'start of month')) LIMIT 1`,
    },
    {
        pregunta: '¿Cuáles son los 5 productos más vendidos este mes?',
        sql: `SELECT p.nombre, SUM(vi.cantidad) AS total_vendido FROM venta_item vi JOIN producto p ON p.id = vi.producto_id JOIN venta v ON v.id = vi.venta_id WHERE v.estado = 'pagada' AND v.creado_en >= (strftime('%s', 'now', 'start of month')) GROUP BY p.id ORDER BY total_vendido DESC LIMIT 5`,
    },
];
