/**
 * Banco curado de "ejemplos dorados" (pregunta → SQL) para Binny.
 *
 * Objetivo: mejorar la precisión del modelo SIN cambiar el LLM. Los ejemplos se
 * inyectan agrupados por familia en el prompt de los modos que generan consultas
 * (json, stream, fase1, agente) y no en los que solo narran (brief, informe).
 *
 * Reglas de este banco:
 * - Preguntas escritas como las hace un comerciante (lenguaje coloquial).
 * - SQL válido para `ESQUEMA_SQLITE`: solo tablas/vistas y columnas existentes,
 *   de solo lectura, con `LIMIT` donde corresponde.
 * - TODO ejemplo debe pasar `validarSQL` (lo verifica `scripts/evaluar-binny.mts`).
 * - Se prioriza que el banco NO se registre como escritura: nada de INSERT/UPDATE/etc.
 *
 * Se conserva el export histórico `EJEMPLOS_CONSULTAS` (plano) por compatibilidad
 * de imports; `chat.esquema.ts` lo re-exporta.
 */

export interface EjemploConsulta {
  pregunta: string;
  sql: string;
  /** Por qué es delicado / qué patrón enseña (solo para humanos, no va al prompt). */
  nota?: string;
}

export const FAMILIAS_EJEMPLOS = [
  'ventas',
  'stock_inventario',
  'caja_turnos',
  'margenes_rentabilidad',
  'clientes_cuenta_corriente',
  'gastos',
  'compras_proveedores',
  'presupuestos',
  'productos_catalogo',
] as const;

export type FamiliaEjemplos = (typeof FAMILIAS_EJEMPLOS)[number];

/** Etiquetas humanas que se muestran como encabezado de cada familia en el prompt. */
export const ETIQUETAS_FAMILIA: Record<FamiliaEjemplos, string> = {
  ventas: 'Ventas y facturación',
  stock_inventario: 'Stock e inventario',
  caja_turnos: 'Caja y turnos',
  margenes_rentabilidad: 'Márgenes y rentabilidad',
  clientes_cuenta_corriente: 'Clientes y cuenta corriente',
  gastos: 'Gastos y egresos',
  compras_proveedores: 'Compras y proveedores',
  presupuestos: 'Presupuestos',
  productos_catalogo: 'Productos y catálogo',
};

export const EJEMPLOS_POR_FAMILIA: Record<FamiliaEjemplos, EjemploConsulta[]> = {
  ventas: [
    {
      pregunta: '¿Cuánto vendí hoy?',
      sql: `SELECT SUM(total) AS total_hoy FROM venta WHERE estado = 'completada' AND anulada_en IS NULL AND DATE(creada_en, 'unixepoch', 'localtime') = DATE('now', 'localtime') LIMIT 1`,
    },
    {
      pregunta: '¿Qué productos me dejaron más ingresos este mes?',
      sql: `SELECT producto_nombre, SUM(cantidad) AS unidades, SUM(item_subtotal) AS facturado FROM vista_ventas_detalle WHERE estado = 'completada' AND anulada_en IS NULL AND creada_en >= strftime('%s', 'now', 'start of month') GROUP BY producto_id ORDER BY facturado DESC LIMIT 10`,
      nota: 'Top N: GROUP BY por id + ORDER BY total DESC + LIMIT. Nunca listar sin LIMIT.',
    },
    {
      pregunta: '¿Cómo vienen las ventas de este mes comparadas con el mes pasado?',
      sql: `SELECT
  SUM(CASE WHEN creada_en >= strftime('%s', 'now', 'start of month') THEN total ELSE 0 END) AS mes_actual,
  SUM(CASE WHEN creada_en >= strftime('%s', 'now', 'start of month', '-1 month') AND creada_en < strftime('%s', 'now', 'start of month') THEN total ELSE 0 END) AS mes_anterior
FROM venta
WHERE estado = 'completada' AND anulada_en IS NULL
  AND creada_en >= strftime('%s', 'now', 'start of month', '-1 month')
LIMIT 1`,
      nota: 'Comparación de períodos: UN solo SELECT con SUM(CASE WHEN ...) en vez de dos consultas. "Este mes" = start of month, NUNCA DATE(\'now\').',
    },
    {
      pregunta: '¿Qué marcas generaron más ventas este mes?',
      sql: `SELECT marca_nombre, COUNT(DISTINCT venta_id) AS tickets, SUM(item_subtotal) AS facturado FROM vista_ventas_marca WHERE estado = 'completada' AND anulada_en IS NULL AND creada_en >= strftime('%s', 'now', 'start of month') GROUP BY marca_id ORDER BY facturado DESC LIMIT 20`,
      nota: 'Ranking por marca usando la vista. Los productos sin marca salen con marca_nombre NULL: decirlos como "sin marca".',
    },
  ],

  stock_inventario: [
    {
      pregunta: '¿Qué productos tengo con stock bajo el mínimo?',
      sql: `SELECT p.nombre, p.cantidad, p.stock_minimo, u.abreviatura FROM producto p JOIN unidad u ON u.id = p.unidad_id WHERE p.cantidad <= p.stock_minimo AND p.activo = 1 ORDER BY p.cantidad ASC LIMIT 50`,
    },
    {
      pregunta: '¿Qué productos están sin stock?',
      sql: `SELECT nombre, codigo_interno, cantidad FROM producto WHERE cantidad <= 0 AND activo = 1 ORDER BY nombre ASC LIMIT 50`,
      nota: 'Sin stock = cantidad <= 0, distinto de "bajo mínimo" (cantidad <= stock_minimo).',
    },
    {
      pregunta: '¿Qué productos se me vencen en los próximos 30 días?',
      sql: `SELECT nombre, cantidad, DATE(fecha_vencimiento, 'unixepoch', 'localtime') AS vence FROM producto WHERE activo = 1 AND fecha_vencimiento IS NOT NULL AND DATE(fecha_vencimiento, 'unixepoch', 'localtime') <= DATE('now', 'localtime', '+30 days') ORDER BY fecha_vencimiento ASC LIMIT 50`,
      nota: 'Hay que filtrar NULL: los productos sin fecha de vencimiento no deben aparecer.',
    },
  ],

  caja_turnos: [
    {
      pregunta: '¿Qué turno de caja tengo abierto ahora?',
      sql: `SELECT id, monto_inicial, DATETIME(abierto_en, 'unixepoch', 'localtime') AS abierto_desde FROM turno_caja WHERE estado = 'abierto' ORDER BY abierto_en DESC LIMIT 1`,
    },
    {
      pregunta: '¿Cuánto se retiró de la caja hoy?',
      sql: `SELECT COALESCE(SUM(monto), 0) AS retirado_hoy FROM caja_retiro WHERE DATE(fecha, 'unixepoch', 'localtime') = DATE('now', 'localtime') LIMIT 1`,
      nota: 'Agregación que puede dar 0 filas: usar COALESCE para devolver 0 en vez de nada.',
    },
    {
      pregunta: '¿Cómo se cobró hoy? Quiero el total por forma de pago',
      sql: `SELECT vp.metodo, SUM(vp.monto) AS total FROM venta_pago vp JOIN venta v ON v.id = vp.venta_id WHERE v.estado = 'completada' AND v.anulada_en IS NULL AND DATE(v.creada_en, 'unixepoch', 'localtime') = DATE('now', 'localtime') GROUP BY vp.metodo ORDER BY total DESC LIMIT 20`,
      nota: 'Se cobra por venta_pago, pero los pagos de ventas anuladas NO deben contar: joinear con venta y filtrar estado/anulada_en.',
    },
  ],

  margenes_rentabilidad: [
    {
      pregunta: '¿Qué productos me dejan menos margen?',
      sql: `SELECT nombre, precio_costo, precio_venta, ROUND((precio_venta - precio_costo) * 100.0 / NULLIF(precio_venta, 0), 1) AS margen_porcentaje FROM producto WHERE activo = 1 AND precio_venta > 0 ORDER BY margen_porcentaje ASC LIMIT 20`,
      nota: 'NULLIF evita dividir por cero cuando precio_venta = 0.',
    },
    {
      pregunta: '¿Qué productos me generan más ganancia este mes?',
      sql: `SELECT producto_nombre, SUM((precio_unitario - precio_costo) * cantidad) AS ganancia FROM vista_ventas_detalle WHERE estado = 'completada' AND anulada_en IS NULL AND creada_en >= strftime('%s', 'now', 'start of month') GROUP BY producto_id ORDER BY ganancia DESC LIMIT 10`,
      nota: 'Ganancia = SUM((precio_unitario - precio_costo) * cantidad), no la facturación.',
    },
    {
      pregunta: '¿Vendí algo por debajo de mi costo?',
      sql: `SELECT producto_nombre, ROUND(precio_unitario, 2) AS precio_venta, ROUND(precio_costo, 2) AS costo, SUM(cantidad) AS unidades FROM vista_ventas_detalle WHERE estado = 'completada' AND anulada_en IS NULL AND precio_costo > 0 AND precio_unitario < precio_costo GROUP BY producto_id ORDER BY unidades DESC LIMIT 20`,
      nota: 'precio_costo > 0 excluye productos sin costo cargado (evita falsos positivos).',
    },
  ],

  clientes_cuenta_corriente: [
    {
      pregunta: '¿Quién me debe más plata?',
      sql: `SELECT nombre, documento, telefono, saldo_actual FROM vista_deuda_clientes ORDER BY saldo_actual DESC LIMIT 20`,
      nota: 'Cuenta corriente: la deuda vive en cliente.saldo_actual (la vista ya filtra activos con deuda).',
    },
    {
      pregunta: '¿Cuánto me deben en total?',
      sql: `SELECT COALESCE(SUM(saldo_actual), 0) AS deuda_total FROM cliente WHERE saldo_actual > 0 AND activo = 1 LIMIT 1`,
      nota: 'Solo saldos positivos: saldo_actual es negativo cuando el cliente tiene saldo a favor.',
    },
    {
      pregunta: '¿Cuáles fueron los últimos movimientos de cuenta del cliente Pérez?',
      sql: `SELECT cm.tipo, cm.monto, cm.saldo_posterior, cm.concepto, DATETIME(cm.fecha, 'unixepoch', 'localtime') AS fecha FROM cliente_movimiento_cuenta cm JOIN cliente c ON c.id = cm.cliente_id WHERE c.nombre LIKE '%Perez%' AND cm.anulado = 0 ORDER BY cm.fecha DESC LIMIT 50`,
      nota: 'El historial va en cliente_movimiento_cuenta: "cargo" al vender, "pago" al cobrar. Filtrar anulado = 0.',
    },
  ],

  gastos: [
    {
      pregunta: '¿Cuánto gasté este mes?',
      sql: `SELECT COALESCE(SUM(monto), 0) AS total_mes FROM gasto WHERE anulado = 0 AND fecha >= strftime('%s', 'now', 'start of month') LIMIT 1`,
      nota: 'Egresos REALES = tabla gasto con anulado = 0. NO sumar gasto_programado (son compromisos futuros).',
    },
    {
      pregunta: '¿Cuánto gasté en alquiler este mes?',
      sql: `SELECT SUM(g.monto) AS total FROM gasto g JOIN categoria_gasto cg ON cg.id = g.categoria_gasto_id WHERE cg.nombre = 'Alquileres' AND g.anulado = 0 AND g.fecha >= strftime('%s', 'now', 'start of month') LIMIT 1`,
    },
    {
      pregunta: '¿Qué pagos se me vienen esta semana?',
      sql: `SELECT gp.concepto, gp.monto, gp.tipo, gp.auto_generar, DATETIME(gp.proxima_ejecucion, 'unixepoch', 'localtime') AS fecha_pago, cg.nombre AS categoria FROM gasto_programado gp LEFT JOIN categoria_gasto cg ON cg.id = gp.categoria_gasto_id WHERE gp.activo = 1 AND gp.proxima_ejecucion BETWEEN strftime('%s', 'now') AND strftime('%s', 'now', '+7 days') ORDER BY gp.proxima_ejecucion ASC LIMIT 20`,
      nota: 'Compromisos FUTUROS = gasto_programado con activo = 1, por proxima_ejecucion. No son egresos reales todavía.',
    },
    {
      pregunta: '¿Cuáles son mis gastos fijos o recurrentes mensuales?',
      sql: `SELECT gp.concepto, gp.monto, gp.frecuencia, gp.auto_generar, cg.nombre AS categoria FROM gasto_programado gp LEFT JOIN categoria_gasto cg ON cg.id = gp.categoria_gasto_id WHERE gp.activo = 1 AND gp.tipo = 'recurrente' ORDER BY gp.monto DESC LIMIT 50`,
      nota: 'auto_generar = 0 significa monto estimado (hay que confirmar la boleta); aclararlo al responder.',
    },
  ],

  compras_proveedores: [
    {
      pregunta: '¿Cuánto compré este mes?',
      sql: `SELECT COALESCE(SUM(total), 0) AS total_compras FROM compra WHERE anulada = 0 AND fecha >= strftime('%s', 'now', 'start of month') LIMIT 1`,
      nota: 'Compras anuladas (anulada = 1) no se cuentan.',
    },
    {
      pregunta: '¿A qué proveedor le compré más este mes?',
      sql: `SELECT p.nombre AS proveedor, COUNT(c.id) AS compras, SUM(c.total) AS total FROM compra c JOIN proveedor p ON p.id = c.proveedor_id WHERE c.anulada = 0 AND c.fecha >= strftime('%s', 'now', 'start of month') GROUP BY p.id ORDER BY total DESC LIMIT 20`,
      nota: 'Getter de nombre del proveedor: compra.proveedor_id → proveedor.nombre.',
    },
    {
      pregunta: '¿Cuál fue el último costo al que compré la yerba?',
      sql: `SELECT p.nombre, ci.cantidad, ci.precio_costo, DATETIME(c.fecha, 'unixepoch', 'localtime') AS fecha FROM compra_item ci JOIN compra c ON c.id = ci.compra_id JOIN producto p ON p.id = ci.producto_id WHERE c.anulada = 0 AND p.nombre LIKE '%yerba%' ORDER BY c.fecha DESC LIMIT 20`,
      nota: 'Último costo: compra_item.precio_costo ordenado por fecha DESC.',
    },
  ],

  presupuestos: [
    {
      pregunta: '¿Qué presupuestos tengo pendientes de respuesta?',
      sql: `SELECT pr.numero, c.nombre AS cliente, pr.total, DATE(pr.vence_en, 'unixepoch', 'localtime') AS vence, pr.estado FROM presupuesto pr LEFT JOIN cliente c ON c.id = pr.cliente_id WHERE pr.estado = 'pendiente' ORDER BY pr.vence_en ASC LIMIT 50`,
    },
    {
      pregunta: '¿Qué presupuestos vencieron sin que me respondan?',
      sql: `SELECT pr.numero, c.nombre AS cliente, pr.total, DATE(pr.vence_en, 'unixepoch', 'localtime') AS vence FROM presupuesto pr LEFT JOIN cliente c ON c.id = pr.cliente_id WHERE pr.estado = 'pendiente' AND pr.vence_en < strftime('%s', 'now') ORDER BY pr.vence_en ASC LIMIT 50`,
      nota: 'Vencido = estado pendiente AND vence_en < ahora. No es un estado propio.',
    },
    {
      pregunta: '¿Cuánto valen mis presupuestos según su estado?',
      sql: `SELECT estado, COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total FROM presupuesto GROUP BY estado ORDER BY total DESC LIMIT 20`,
    },
  ],

  productos_catalogo: [
    {
      pregunta: '¿Cuántos productos activos tengo y cuántas unidades en total?',
      sql: `SELECT COUNT(*) AS productos_activos, COALESCE(SUM(cantidad), 0) AS unidades_totales FROM producto WHERE activo = 1 LIMIT 1`,
    },
    {
      pregunta: '¿Qué precios de venta cambié este mes?',
      sql: `SELECT p.nombre, hp.tipo, hp.precio, DATETIME(hp.fecha, 'unixepoch', 'localtime') AS fecha FROM historial_precio hp JOIN producto p ON p.id = hp.producto_id WHERE hp.tipo = 'venta' AND hp.fecha >= strftime('%s', 'now', 'start of month') ORDER BY hp.fecha DESC LIMIT 50`,
      nota: 'historial_precio.tipo distingue "costo" de "venta".',
    },
    {
      pregunta: '¿Cuánto vale mi inventario a costo y a precio de venta?',
      sql: `SELECT ROUND(SUM(cantidad * precio_costo), 2) AS valor_a_costo, ROUND(SUM(cantidad * precio_venta), 2) AS valor_a_venta FROM producto WHERE activo = 1 LIMIT 1`,
    },
  ],
};

/**
 * Export histórico plano (compatibilidad con imports previos de `chat.esquema`).
 * Se deriva del banco por familia para no duplicar datos.
 */
export const EJEMPLOS_CONSULTAS: Array<{ pregunta: string; sql: string }> = FAMILIAS_EJEMPLOS.flatMap(
  (familia) => EJEMPLOS_POR_FAMILIA[familia].map(({ pregunta, sql }) => ({ pregunta, sql })),
);
