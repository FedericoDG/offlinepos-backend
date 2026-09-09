export const ESQUEMA_SQLITE = `
# DB SQLite del POS - Estructura REAL

IMPORTANTE: Usá los nombres de columnas tal cual aparecen. NO inventes columnas.

## Fechas
Timestamps Unix en segundos (INTEGER). "Hoy": DATE(col, 'unixepoch', 'localtime') = DATE('now', 'localtime'). "Este mes": fecha >= strftime('%s', 'now', 'start of month').

## Enums
- venta.estado: "completada" | "anulada". Validas: estado='completada' AND anulada_en IS NULL.
- turno_caja.estado: "abierto" | "cerrado"
- compra/gasto: anulada/anulado = 0 (activo) | 1 (anulado)
- venta_pago.metodo / gasto.metodo_pago: "efectivo" | "debito" | "credito" | "transferencia" | "mercado_pago" | "cuenta_corriente" | "cheque" | "otro"
- movimiento_stock.tipo: "STOCK_INICIAL" | "COMPRA" | "DEVOLUCION_VENTA" | "VENTA" | "AJUSTE_DE_STOCK" | "ANULACION_COMPRA"
- cliente_movimiento_cuenta.tipo: "pago" | "cargo" | "ajuste_debito" | "ajuste_credito"
- presupuesto.estado: "pendiente" | "aprobado" | "cancelado" (vencido se calcula al vuelo)
- usuario.rol: "admin" | "vendedor"
- recargo.tipo: "fijo" | "porcentaje"
- historial_precio.tipo: "costo" | "venta"

## Tablas principales

venta (id, turno_caja_id, usuario_id, cliente_id, total, descuento, estado, nota, anulada_en, anulada_motivo, creada_en, recargo, recargo_concepto)
venta_item (id, venta_id, producto_id, cantidad, precio_unitario, subtotal, descuento_item)
venta_pago (id, venta_id, metodo, monto)
producto (id, codigo_barras, codigo_interno, nombre, cantidad, stock_minimo, unidad_id, precio_venta, precio_costo, permitir_sin_stock, activo, creada_en, marca_id, fecha_vencimiento, lote)
cliente (id, nombre, documento, telefono, saldo_actual, permite_credito, limite_credito, activo, condicion_iva)
turno_caja (id, usuario_id, monto_inicial, abierto_en, cerrado_en, monto_contado_efectivo, estado)
compra (id, proveedor_id, usuario_id, total, actualiza_costo, fecha, anulada, anulada_en)
compra_item (id, compra_id, producto_id, cantidad, precio_costo, subtotal, presentacion_compra_id, factor_conversion_usado)
gasto (id, categoria_gasto_id, monto, fecha, concepto, metodo_pago, usuario_id, anulado, compra_id, turno_caja_id)
cliente_movimiento_cuenta (id, cliente_id, tipo, monto, saldo_anterior, saldo_posterior, concepto, venta_id, usuario_id, fecha, anulado)
movimiento_stock (id, producto_id, tipo, cantidad, stock_resultante, usuario_id, fecha)
caja_retiro (id, turno_caja_id, usuario_id, autorizado_por_usuario_id, monto, motivo, fecha)
historial_precio (id, producto_id, tipo, precio, fecha)
presentacion_compra (id, producto_id, nombre, factor_conversion, activo)
promocion (id, nombre, activo, prioridad, condiciones_json, efectos_json)
recargo (id, nombre, tipo, valor, activo, categoria)
combo (id, nombre, codigo_interno, codigo_barras, precio_venta, activo)
combo_item (id, combo_id, producto_id, cantidad)
presupuesto (id, numero, cliente_id, usuario_id, total, descuento, vence_en, estado, venta_id, convertido_en, recargo)
presupuesto_item (id, presupuesto_id, producto_id, cantidad, precio_unitario, subtotal, descuento_item)
proveedor (id, nombre, telefono, email, activo)
categoria (id, nombre, activo)
categoria_gasto (id, nombre, activo)
marca (id, nombre, activo)
unidad (id, abreviatura, nombre, activo)
usuario (id, usuario, rol, activo, permisos)
config (clave, valor)

## Notas
- Un turno_caja tiene varias ventas, caja_retiros y gastos.
- Producto se une a categorias via producto_categoria (tabla puente).
- Presupuesto vencido se calcula: estado='pendiente' AND vence_en < now.
- Cuenta corriente: tipo='cargo' al vender, tipo='pago' al cobrar.
- Seeds: cliente "Consumidor Final", unidad "un" (Unidades).
- Seeds categoria_gasto: Servicios, Alquileres, Sueldos, Impuestos, Insumos, Mantenimiento, Fletes, Marketing, Otros.
`;
export const EJEMPLOS_CONSULTAS = [
    {
        pregunta: 'Cuanto facture hoy?',
        sql: `SELECT SUM(total) AS total_hoy FROM venta WHERE estado = 'completada' AND anulada_en IS NULL AND DATE(creada_en, 'unixepoch', 'localtime') = DATE('now', 'localtime') LIMIT 1`,
    },
    {
        pregunta: 'Productos con stock bajo el minimo',
        sql: `SELECT p.nombre, p.cantidad, p.stock_minimo, u.abreviatura FROM producto p JOIN unidad u ON u.id = p.unidad_id WHERE p.cantidad <= p.stock_minimo AND p.activo = 1 ORDER BY p.cantidad ASC LIMIT 50`,
    },
    {
        pregunta: 'Cliente que mas debe',
        sql: `SELECT nombre, documento, saldo_actual FROM cliente WHERE saldo_actual > 0 AND activo = 1 ORDER BY saldo_actual DESC LIMIT 10`,
    },
    {
        pregunta: 'Gasto en alquiler este mes',
        sql: `SELECT SUM(g.monto) AS total FROM gasto g JOIN categoria_gasto cg ON cg.id = g.categoria_gasto_id WHERE cg.nombre = 'Alquileres' AND g.anulado = 0 AND g.fecha >= strftime('%s', 'now', 'start of month') LIMIT 1`,
    },
];
