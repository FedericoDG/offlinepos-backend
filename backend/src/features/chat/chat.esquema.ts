export const ESQUEMA_SQLITE = `
# DB SQLite del POS. Usá columnas tal cual: NO inventes.
## Fechas: timestamps Unix INTEGER. Hoy: DATE(col,'unixepoch','localtime')=DATE('now','localtime'). Mes: fecha >= strftime('%s','now','start of month').
## Enums
- venta.estado: "completada"|"anulada". Válidas: estado='completada' AND anulada_en IS NULL.
- turno_caja.estado: "abierto"|"cerrado". compra/gasto anulada: 0|1.
- venta_pago.metodo, gasto.metodo_pago: "efectivo"|"debito"|"credito"|"transferencia"|"mercado_pago"|"cuenta_corriente"|"cheque"|"otro".
- gasto_programado: tipo "unica_vez"|"recurrente"; frecuencia "diario"|"semanal"|"quincenal"|"mensual"|"anual"; activo 1|0; auto_generar 1 (automático) | 0 (requiere confirmar importe, ej: luz/gas).
- movimiento_stock.tipo: "STOCK_INICIAL"|"COMPRA"|"DEVOLUCION_VENTA"|"VENTA"|"AJUSTE_DE_STOCK"|"ANULACION_COMPRA".
- cliente_movimiento_cuenta.tipo: "pago"|"cargo"|"ajuste_debito"|"ajuste_credito".
- presupuesto.estado: "pendiente"|"aprobado"|"cancelado" (vencido: pendiente AND vence_en < ahora).
- usuario.rol: "admin"|"vendedor". recargo.tipo: "fijo"|"porcentaje". historial_precio.tipo: "costo"|"venta".
## Tablas
venta (id, turno_caja_id, usuario_id, cliente_id, total, descuento, estado, nota, anulada_en, anulada_motivo, creada_en, recargo, recargo_concepto, total_neto, total_iva)
venta_item (id, venta_id, producto_id, cantidad, precio_unitario, subtotal, descuento_item, precio_neto, alicuota_iva_porcentaje, monto_iva)
venta_pago (id, venta_id, metodo, monto)
producto (id, codigo_barras, codigo_interno, nombre, cantidad, stock_minimo, unidad_id, precio_venta, precio_costo, permitir_sin_stock, activo, creada_en, marca_id, fecha_vencimiento, lote, alicuota_iva_id)
alicuota_iva (id, nombre, porcentaje, codigo_afip, activo, predeterminada, creada_en)
cliente (id, nombre, documento, telefono, saldo_actual, permite_credito, limite_credito, activo, condicion_iva)
turno_caja (id, usuario_id, monto_inicial, abierto_en, cerrado_en, monto_contado_efectivo, estado)
compra (id, proveedor_id, usuario_id, total, actualiza_costo, fecha, anulada, anulada_en)
compra_item (id, compra_id, producto_id, cantidad, precio_costo, subtotal, presentacion_compra_id, factor_conversion_usado)
gasto (id, categoria_gasto_id, monto, fecha, concepto, metodo_pago, usuario_id, anulado, compra_id, turno_caja_id, gasto_programado_id)
gasto_programado (id, concepto, monto, categoria_gasto_id, proveedor_id, metodo_pago, comprobante, nota, usuario_id, tipo, frecuencia, intervalo, dia_semana, dia_mes, fecha_inicio, fecha_fin, proxima_ejecucion, ultima_ejecucion, auto_generar, activo, total_ejecuciones, creado_en, actualizado_en)
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
recordatorio (id, usuario_id, titulo, descripcion, fecha_hora_programada, completado, disparado, pospuesto_hasta, sonido, creado_en, actualizado_en)
config (clave, valor)
## Vistas (PREFERILAS a joins manuales; SELECT+WHERE+LIMIT)
vista_ventas_detalle (venta_id, venta_total, descuento, estado, anulada_en, creada_en, usuario_id, cliente_id, total_iva, producto_id, cantidad, precio_unitario, item_subtotal, descuento_item, precio_neto, producto_nombre, codigo_interno, precio_costo, metodo_pago, pago_monto)
- Válidas: estado='completada' AND anulada_en IS NULL. Ej: SELECT producto_nombre, SUM(cantidad) AS un FROM vista_ventas_detalle WHERE estado='completada' AND anulada_en IS NULL AND DATE(creada_en,'unixepoch','localtime')=DATE('now','localtime') GROUP BY producto_id LIMIT 50
vista_deuda_clientes (id, nombre, documento, telefono, saldo_actual, limite_credito, ultimo_movimiento)
- Solo con deuda y activos. Ej: SELECT nombre, saldo_actual FROM vista_deuda_clientes ORDER BY saldo_actual DESC LIMIT 10
vista_stock_critico (id, nombre, codigo_interno, cantidad, stock_minimo, precio_costo, precio_venta, unidad)
- Activos con stock <= mínimo. Ej: SELECT nombre, cantidad FROM vista_stock_critico LIMIT 20
vista_gastos_mes (id, concepto, monto, fecha, metodo_pago, comprobante, categoria)
- No anulados del mes. Ej: SELECT categoria, SUM(monto) AS total FROM vista_gastos_mes GROUP BY categoria LIMIT 20
## Notas
- turno_caja → ventas, retiros, gastos. Producto↔categorias vía producto_categoria (puente).
- Cuenta corriente: 'cargo' al vender, 'pago' al cobrar.
- Seeds: cliente "Consumidor Final", unidad "un"; categoria_gasto: Servicios, Alquileres, Sueldos, Impuestos, Insumos, Mantenimiento, Fletes, Marketing, Otros.
- gasto_programado son reglas futuras: NO restan caja hasta asentarse en gasto (gasto.gasto_programado_id = origen). proxima_ejecucion es Unix.
- recordatorio: fecha_hora_programada es Unix; pendientes completado=0; sonido 'sound_01'-'sound_05' o null.
- IVA: producto.alicuota_iva_id → alicuota_iva. Si usar_iva='1': venta.total_iva = débito fiscal, venta.total_neto = base.
`;

export const EJEMPLOS_CONSULTAS: Array<{ pregunta: string; sql: string }> = [
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
  {
    pregunta: 'Que gastos o pagos tengo programados para los proximos dias?',
    sql: `SELECT gp.concepto, gp.monto, gp.tipo, gp.frecuencia, gp.auto_generar, DATETIME(gp.proxima_ejecucion, 'unixepoch', 'localtime') AS fecha_pago, cg.nombre AS categoria FROM gasto_programado gp LEFT JOIN categoria_gasto cg ON cg.id = gp.categoria_gasto_id WHERE gp.activo = 1 AND gp.proxima_ejecucion BETWEEN strftime('%s', 'now') AND strftime('%s', 'now', '+7 days') ORDER BY gp.proxima_ejecucion ASC LIMIT 20`,
  },
  {
    pregunta: 'Cuales son mis gastos fijos o recurrentes mensuales?',
    sql: `SELECT gp.concepto, gp.monto, gp.frecuencia, gp.auto_generar, cg.nombre AS categoria FROM gasto_programado gp LEFT JOIN categoria_gasto cg ON cg.id = gp.categoria_gasto_id WHERE gp.activo = 1 AND gp.tipo = 'recurrente' ORDER BY gp.monto DESC LIMIT 50`,
  },
  {
    pregunta: 'Tengo boletas o facturas variables pendientes de confirmar?',
    sql: `SELECT gp.id, gp.concepto, gp.monto AS monto_estimado, DATETIME(gp.proxima_ejecucion, 'unixepoch', 'localtime') AS vencio_el FROM gasto_programado gp WHERE gp.activo = 1 AND gp.auto_generar = 0 AND gp.proxima_ejecucion <= strftime('%s', 'now') ORDER BY gp.proxima_ejecucion ASC LIMIT 20`,
  },
  {
    pregunta: 'Que recordatorios o tareas pendientes tengo agendadas?',
    sql: `SELECT id, titulo, descripcion, DATETIME(fecha_hora_programada, 'unixepoch', 'localtime') AS programado_para, sonido FROM recordatorio WHERE completado = 0 ORDER BY fecha_hora_programada ASC LIMIT 20`,
  },
];
