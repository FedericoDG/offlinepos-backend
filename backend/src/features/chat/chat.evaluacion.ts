/**
 * Corpus de evaluación de Binny (E3).
 *
 * Cada pregunta describe qué consulta sería correcta de forma verificable SIN
 * base de datos ni licencia:
 * - `tablas_esperadas`: tablas/vistas que la consulta DEBE usar (basta con que
 *   aparezca al menos una de las alternativas listadas).
 * - `columnas_clave`: columnas que la consulta DEBE referenciar.
 * - `prohibido`: identificadores/palabras que la consulta NO debe usar (p. ej.
 *   sumar `gasto_programado` cuando la pregunta pide egresos reales).
 *
 * El corpus lo consume `scripts/evaluar-binny.mts`: en modo determinístico valida
 * su forma; en modo `--llm` lo usa para puntuar al modelo real.
 */

import type { FamiliaEjemplos } from './chat.ejemplos';

export interface PreguntaEvaluacion {
  id: string;
  familia: FamiliaEjemplos;
  pregunta: string;
  tablas_esperadas: string[];
  columnas_clave?: string[];
  prohibido?: string[];
}

export const CORPUS_EVALUACION: PreguntaEvaluacion[] = [
  // --- Ventas ---
  {
    id: 'ventas-hoy',
    familia: 'ventas',
    pregunta: '¿Cuánto vendí hoy?',
    tablas_esperadas: ['venta'],
    columnas_clave: ['total', 'creada_en'],
    prohibido: ['gasto', 'gasto_programado', 'compra'],
  },
  {
    id: 'ventas-top-productos',
    familia: 'ventas',
    pregunta: '¿Qué productos me dejaron más ingresos este mes?',
    tablas_esperadas: ['vista_ventas_detalle', 'venta_item'],
    columnas_clave: ['cantidad'],
    prohibido: ['gasto_programado'],
  },
  {
    id: 'ventas-periodo',
    familia: 'ventas',
    pregunta: '¿Cómo vienen las ventas de este mes comparadas con el mes pasado?',
    tablas_esperadas: ['venta'],
    columnas_clave: ['total', 'creada_en'],
    prohibido: ['gasto', 'gasto_programado', 'compra'],
  },
  {
    id: 'ventas-metodo-pago',
    familia: 'ventas',
    pregunta: '¿Cómo se cobró hoy? Quiero el total por cada forma de pago',
    tablas_esperadas: ['venta_pago'],
    columnas_clave: ['metodo', 'monto'],
    prohibido: ['gasto_programado'],
  },

  // --- Stock e inventario ---
  {
    id: 'stock-bajo-minimo',
    familia: 'stock_inventario',
    pregunta: '¿Qué productos tengo que reponer?',
    tablas_esperadas: ['producto', 'vista_stock_critico'],
    columnas_clave: ['stock_minimo'],
    prohibido: [],
  },
  {
    id: 'stock-sin-stock',
    familia: 'stock_inventario',
    pregunta: '¿Qué productos están sin stock?',
    tablas_esperadas: ['producto'],
    columnas_clave: ['cantidad'],
    prohibido: [],
  },
  {
    id: 'stock-por-vencer',
    familia: 'stock_inventario',
    pregunta: '¿Qué productos se me vencen este mes?',
    tablas_esperadas: ['producto'],
    columnas_clave: ['fecha_vencimiento'],
    prohibido: [],
  },

  // --- Caja y turnos ---
  {
    id: 'caja-turno-abierto',
    familia: 'caja_turnos',
    pregunta: '¿Qué turno de caja tengo abierto ahora?',
    tablas_esperadas: ['turno_caja'],
    columnas_clave: ['estado'],
    prohibido: [],
  },
  {
    id: 'caja-retiros-hoy',
    familia: 'caja_turnos',
    pregunta: '¿Cuánto se retiró de la caja hoy?',
    tablas_esperadas: ['caja_retiro'],
    columnas_clave: ['monto'],
    prohibido: [],
  },
  {
    id: 'caja-ultimo-cierre',
    familia: 'caja_turnos',
    pregunta: '¿Cómo cerró el último turno de caja?',
    tablas_esperadas: ['turno_caja'],
    columnas_clave: ['monto_contado_efectivo', 'cerrado_en'],
    prohibido: [],
  },

  // --- Márgenes y rentabilidad ---
  {
    id: 'margen-mas-bajo',
    familia: 'margenes_rentabilidad',
    pregunta: '¿Qué productos me dejan menos margen?',
    tablas_esperadas: ['producto'],
    columnas_clave: ['precio_costo', 'precio_venta'],
    prohibido: [],
  },
  {
    id: 'margen-mas-ganancia',
    familia: 'margenes_rentabilidad',
    pregunta: '¿Qué productos me generan más ganancia este mes?',
    tablas_esperadas: ['vista_ventas_detalle', 'venta_item'],
    columnas_clave: ['precio_costo', 'cantidad'],
    prohibido: [],
  },

  // --- Clientes y cuenta corriente ---
  {
    id: 'cc-quien-debe-mas',
    familia: 'clientes_cuenta_corriente',
    pregunta: '¿Quién me debe más plata?',
    tablas_esperadas: ['cliente', 'vista_deuda_clientes'],
    columnas_clave: ['saldo_actual'],
    prohibido: ['cliente_movimiento_cuenta'],
  },
  {
    id: 'cc-deuda-total',
    familia: 'clientes_cuenta_corriente',
    pregunta: '¿Cuánto me deben en total?',
    tablas_esperadas: ['cliente', 'vista_deuda_clientes'],
    columnas_clave: ['saldo_actual'],
    prohibido: [],
  },
  {
    id: 'cc-movimientos-cliente',
    familia: 'clientes_cuenta_corriente',
    pregunta: 'Mostrame los últimos movimientos de cuenta del cliente Pérez',
    tablas_esperadas: ['cliente_movimiento_cuenta'],
    columnas_clave: ['monto', 'tipo'],
    prohibido: [],
  },

  // --- Gastos ---
  {
    id: 'gasto-total-mes',
    familia: 'gastos',
    pregunta: '¿Cuánto gasté este mes?',
    tablas_esperadas: ['gasto', 'vista_gastos_mes'],
    columnas_clave: ['monto'],
    prohibido: ['gasto_programado'],
  },
  {
    id: 'gasto-por-categoria',
    familia: 'gastos',
    pregunta: '¿En qué se me va la plata este mes? Desglosá por categoría',
    tablas_esperadas: ['gasto', 'categoria_gasto', 'vista_gastos_mes'],
    columnas_clave: ['monto'],
    prohibido: ['gasto_programado'],
  },

  // --- Compras y proveedores ---
  {
    id: 'compras-total-mes',
    familia: 'compras_proveedores',
    pregunta: '¿Cuánto compré este mes?',
    tablas_esperadas: ['compra'],
    columnas_clave: ['total'],
    prohibido: ['gasto'],
  },
  {
    id: 'compras-proveedor-top',
    familia: 'compras_proveedores',
    pregunta: '¿A qué proveedor le compré más este mes?',
    tablas_esperadas: ['compra', 'proveedor'],
    columnas_clave: ['total'],
    prohibido: [],
  },

  // --- Presupuestos ---
  {
    id: 'presupuestos-pendientes',
    familia: 'presupuestos',
    pregunta: '¿Qué presupuestos tengo pendientes de respuesta?',
    tablas_esperadas: ['presupuesto'],
    columnas_clave: ['estado'],
    prohibido: [],
  },

  // --- Productos y catálogo ---
  {
    id: 'productos-valor-inventario',
    familia: 'productos_catalogo',
    pregunta: '¿Cuánto vale mi inventario a costo?',
    tablas_esperadas: ['producto'],
    columnas_clave: ['precio_costo', 'cantidad'],
    prohibido: [],
  },
];
