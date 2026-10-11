/**
 * Prueba END-TO-END de Binny (modo agente real).
 *
 * Replica el flujo productivo completo por cada pregunta del corpus
 * `src/features/chat/chat.prueba.e2e.ts`:
 *
 *   1. Prompt de sistema con `construirPromptSistema('agente', contexto, pregunta)`.
 *      El contexto incluye un `resumen_negocio` precocinado (igual que el
 *      desktop) para que las preguntas respondibles desde el resumen tengan dato.
 *      Si el caso declara `historial` (OPCIONAL), esos turnos previos se insertan
 *      entre el prompt de sistema y la pregunta, para probar referencias a la
 *      respuesta anterior ("esos datos", "esa tabla").
 *   2. Llamada al proveedor CON herramientas (`HERRAMIENTAS_AGENTE`) usando la
 *      misma capa que el servicio (`llamarLLMAgenteStream`), no `llamarLLM` suelto.
 *   3. El modelo ya NO escribe SQL libre: solo invoca motores deterministas y
 *      narra el resultado. Como los motores viven en el desktop (Rust), acá se
 *      devuelve un resultado SIMULADO razonable, marcado con "simulado":true.
 *      Las herramientas `ultima_venta` / `ultima_compra` y las operaciones
 *      tipadas `consultar_ventas`, `consultar_compras`, `consultar_gastos`,
 *      `consultar_productos`, `consultar_movimientos_stock`,
 *      `consultar_presupuestos`, `consultar_clientes`, `consultar_proveedores`
 *      y `consultar_turnos_caja` también se simulan
 *      con el contrato JSON del desktop (respetando `limite`, `orden` e `id`).
 *   4. Se sigue el loop hasta texto final (máx. 10 pasos con herramientas).
 *   5. Se aplica el ESPEJO de guardas determinísticas del producto
 *      (`aplicarGuardasEspejo`): normalizarSeguir + quitarNombresInternos +
 *      quitarBloquesTecnicos + quitarOfertaFinal + quitarDisculpas, en ese
 *      orden. Así la tasa mide lo que REALMENTE ve el comerciante. Se cuentan
 *      aparte cuántas veces se disparó cada guarda (métrica informativa) y se
 *      evalúan las reglas del corpus con las funciones puras de
 *      `chat.prueba.e2e.ts`.
 *
 * LIMITACIÓN DOCUMENTADA: TODOS los motores (incluidos ultima_venta/ultima_compra
 * y las operaciones tipadas consultar_ventas/consultar_compras) y
 * `guardar_memoria` viven en el desktop en Rust: acá se simulan. El modelo debe
 * narrar el resultado simulado o, si el dato no está entre los resultados de las
 * herramientas, decir con honestidad que no lo tiene.
 *
 * Uso:
 *   npx tsx scripts/prueba-binny-e2e.mts
 *   npx tsx scripts/prueba-binny-e2e.mts --filtro=combo
 *   npx tsx scripts/prueba-binny-e2e.mts --repes=3 --concurrencia=2
 *
 * Salida: /tmp/opencode/prueba-binny-e2e.md. Exit 1 si algún caso falla.
 */
import fs from 'node:fs';
import path from 'node:path';

import { env } from '../src/config/env';
import {
  HERRAMIENTAS_AGENTE,
  construirPromptSistema,
} from '../src/features/chat/chat.service';
import {
  aplicarGuardasEspejo,
  type DisparosGuardas,
} from '../src/features/chat/chat.guardas.espejo';
import { llamarLLMAgenteStream, type AgenteMessage, type AgenteToolCall } from '../src/features/chat/chat.llm';
import {
  CORPUS_PRUEBA_E2E,
  evaluarCasoE2E,
  type CasoPruebaE2E,
  type ResultadoCasoE2E,
} from '../src/features/chat/chat.prueba.e2e';
import type { ContextoNegocioDTO } from '../src/features/chat/chat.dtos';

// --- Argumentos ---
function valorArg(nombre: string): string | undefined {
  const conIgual = process.argv.find((a) => a.startsWith(`${nombre}=`));
  if (conIgual) return conIgual.slice(nombre.length + 1);
  const idx = process.argv.indexOf(nombre);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

const FILTRO = valorArg('--filtro')?.trim().toLowerCase();
const REPES = Math.max(1, Number(valorArg('--repes') ?? '1') || 1);
const CONCURRENCIA = Math.max(1, Number(valorArg('--concurrencia') ?? '2') || 2);
const RUTA_REPORTE = '/tmp/opencode/prueba-binny-e2e.md';
const MAX_PASOS = 10;
const MAX_JSON_CHARS = 6000;

// --- Contexto del comercio (el desktop lo manda fresco en cada turno) ---

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function contextoActual(): ContextoNegocioDTO {
  const d = new Date();
  const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return {
    usar_iva: true,
    fecha_actual: fecha,
    hora_actual: hora,
    dia_semana: DIAS[d.getDay()],
    resumen_negocio: [
      `- Fecha: ${fecha} (${DIAS[d.getDay()]}).`,
      '- Ventas hoy: $45.000 en 12 tickets (ticket promedio $3.750). Ayer: $38.500. Variación vs ayer: 16,9%.',
      '- Caja: abierta (monto actual $82.000). Productos agotados: 2, con bajo stock: 7. Deuda total de clientes: $120.000. Gastos del mes: $380.000. Presupuestos pendientes: 1. Productos por vencer: 3.',
      '- Ventas últimos 7 días (día:total): Lun:52000 Mar:61000 Mié:48000 Jue:57000 Vie:73000 Sáb:45000 Dom:0.',
      '- Alertas detectadas: [alta] Stock crítico: 2 productos sin stock. | [media] Capital parado: $38.000 en vino sin rotación.',
      '- Gastos programados próximos 7 días: 2 por un total de $95.000.',
    ].join('\n'),
    modulos_activos: {
      usar_marca: true,
      usar_categoria: true,
      categoria_multiple: false,
      usar_presentaciones: true,
      usar_iva: true,
      usar_proveedor: true,
      usar_gastos: true,
      usar_clientes: true,
      usar_presupuestos: true,
      usar_combos: true,
      usar_promociones: true,
      usar_vencimientos: true,
      usar_etiquetas: true,
      usar_recargos: true,
      usar_recordatorios: true,
      usar_balanza: false,
    },
  };
}
const CONTEXTO = contextoActual();


// --- Herramientas nativas de analítica / memoria: SIMULADAS ---
// No viven en el backend (se ejecutan en el desktop, en Rust). Se devuelve un
// resultado plausible marcado como simulado para poder ejercitar el loop.

// --- Operaciones tipadas: fixtures SIMULADOS (coherentes con el contrato) ---
// El builder real (filtros → SQL) vive en el desktop (Rust). Acá se emula el
// resultado que devuelve el contrato para que el modelo pueda narrarlo:
//   lista:   { operacion, periodo_resuelto, filtros, total, filas }
//   detalle: { operacion, detalle }
// Se respetan `limite`, `orden` e `id` (y los filtros de la entidad).

const LIMITACION_SIMULADO =
  'resultado simulado por el banco de pruebas (la operación real vive en el desktop)';

/** Registro interno de una venta (insumo del filtro; NO es la salida). */
interface RegistroVenta {
  id: number;
  fecha: string;
  total: number;
  estado: string;
  nota: string | null;
  cliente: string;
  cliente_id: number;
  usuario: string;
  usuario_id: number;
  turno_id: number;
  anulada: boolean;
  medio_pago: string;
  items: Array<{ producto: string; cantidad: number; precio_unitario: number; subtotal: number }>;
  pagos: Array<{ metodo: string; monto: number }>;
}

/** Fila de lista de ventas: claves exactas de `consultar_ventas` (lista). */
interface FilaVenta {
  id: number;
  fecha: string;
  total: number;
  cliente: string;
  usuario: string;
  medios_pago: string;
  cantidad_items: number;
}

/** Detalle de venta: claves exactas de `consultar_ventas` (detalle). */
interface DetalleVenta {
  id: number;
  fecha: string;
  total: number;
  estado: string;
  cliente: string;
  usuario: string;
  nota: string | null;
  items: Array<{ producto: string; cantidad: number; precio_unitario: number; subtotal: number }>;
  pagos: Array<{ metodo: string; monto: number }>;
}

const VENTAS_FIXTURE: RegistroVenta[] = [
  {
    id: 1240, fecha: '2026-10-10 19:42', total: 8750, estado: 'completada', nota: null,
    cliente: 'Consumidor Final', cliente_id: 0, usuario: 'Ana', usuario_id: 2, turno_id: 55,
    anulada: false, medio_pago: 'efectivo',
    items: [
      { producto: 'Coca-Cola 1.5L', cantidad: 2, precio_unitario: 2500, subtotal: 5000 },
      { producto: 'Pan lactal', cantidad: 1, precio_unitario: 3750, subtotal: 3750 },
    ],
    pagos: [{ metodo: 'efectivo', monto: 8750 }],
  },
  {
    id: 1239, fecha: '2026-10-10 18:15', total: 15200, estado: 'completada', nota: null,
    cliente: 'María López', cliente_id: 7, usuario: 'Ana', usuario_id: 2, turno_id: 55,
    anulada: false, medio_pago: 'debito',
    items: [
      { producto: 'Yerba 1kg', cantidad: 2, precio_unitario: 6200, subtotal: 12400 },
      { producto: 'Azúcar 1kg', cantidad: 1, precio_unitario: 2800, subtotal: 2800 },
    ],
    pagos: [{ metodo: 'debito', monto: 15200 }],
  },
  {
    id: 1238, fecha: '2026-10-10 17:03', total: 4300, estado: 'anulada', nota: 'Anulada por error de cobro',
    cliente: 'Consumidor Final', cliente_id: 0, usuario: 'Beto', usuario_id: 3, turno_id: 55,
    anulada: true, medio_pago: 'efectivo',
    items: [{ producto: 'Leche 1L', cantidad: 1, precio_unitario: 4300, subtotal: 4300 }],
    pagos: [{ metodo: 'efectivo', monto: 4300 }],
  },
  {
    id: 1237, fecha: '2026-10-09 20:10', total: 9800, estado: 'completada', nota: null,
    cliente: 'Juan Pérez', cliente_id: 12, usuario: 'Ana', usuario_id: 2, turno_id: 54,
    anulada: false, medio_pago: 'cuenta_corriente',
    items: [{ producto: 'Fernet Branca 750ml', cantidad: 1, precio_unitario: 9800, subtotal: 9800 }],
    pagos: [{ metodo: 'cuenta_corriente', monto: 9800 }],
  },
];

/** Registro interno de una compra (insumo del filtro; NO es la salida). */
interface RegistroCompra {
  id: number;
  fecha: string;
  total: number;
  proveedor: string;
  proveedor_id: number;
  anulada: boolean;
  numero_comprobante: string | null;
  nota: string | null;
  items: Array<{ producto: string; cantidad: number; precio_costo: number; subtotal: number }>;
}

/** Fila de lista de compras: claves exactas de `consultar_compras` (lista). */
interface FilaCompra {
  id: number;
  fecha: string;
  proveedor: string;
  total: number;
  cantidad_items: number;
}

/** Detalle de compra: claves exactas de `consultar_compras` (detalle). */
interface DetalleCompra {
  id: number;
  fecha: string;
  proveedor: string;
  total: number;
  anulada: boolean;
  numero_comprobante: string | null;
  nota: string | null;
  items: Array<{ producto: string; cantidad: number; precio_costo: number; subtotal: number }>;
}

const COMPRAS_FIXTURE: RegistroCompra[] = [
  {
    id: 90, fecha: '2026-10-09 10:15', total: 156000, proveedor: 'Distribuidora Norte', proveedor_id: 1,
    anulada: false, numero_comprobante: 'FC-A-0001-00000123', nota: null,
    items: [
      { producto: 'Coca-Cola 1.5L', cantidad: 24, precio_costo: 1900, subtotal: 45600 },
      { producto: 'Yerba 1kg', cantidad: 12, precio_costo: 6200, subtotal: 74400 },
    ],
  },
  {
    id: 89, fecha: '2026-10-05 09:40', total: 42000, proveedor: 'Lácteos del Sur', proveedor_id: 2,
    anulada: false, numero_comprobante: 'FC-B-0002-00000045', nota: null,
    items: [{ producto: 'Leche 1L', cantidad: 60, precio_costo: 700, subtotal: 42000 }],
  },
  {
    id: 88, fecha: '2026-09-28 11:20', total: 38000, proveedor: 'Distribuidora Norte', proveedor_id: 1,
    anulada: false, numero_comprobante: 'FC-A-0001-00000118', nota: null,
    items: [{ producto: 'Fernet Branca 750ml', cantidad: 8, precio_costo: 4750, subtotal: 38000 }],
  },
];

/** Registro interno de un gasto (insumo del filtro; NO es la salida). */
interface RegistroGasto {
  id: number;
  fecha: string;
  monto: number;
  concepto: string;
  categoria: string;
  categoria_id: number;
  metodo_pago: string;
  comprobante: string | null;
  proveedor: string | null;
  nota: string | null;
  anulado: boolean;
  anulado_motivo: string | null;
  turno_caja_id: number | null;
  programado: boolean;
}

/** Fila de lista de gastos: claves exactas de `consultar_gastos` (lista). */
interface FilaGasto {
  id: number;
  fecha: string;
  concepto: string;
  monto: number;
  categoria: string;
  metodo_pago: string;
  comprobante: string | null;
}

/** Detalle de gasto registrado: claves exactas de `consultar_gastos` (detalle). */
interface DetalleGasto {
  id: number;
  fecha: string;
  concepto: string;
  monto: number;
  categoria: string;
  metodo_pago: string;
  comprobante: string | null;
  proveedor: string | null;
  nota: string | null;
  anulado: boolean;
  anulado_motivo: string | null;
  atado_a_turno: boolean;
  turno_caja_id: number | null;
}

const GASTOS_FIXTURE: RegistroGasto[] = [
  {
    id: 501, fecha: '2026-10-09 09:30', monto: 38000, concepto: 'Alquiler del local',
    categoria: 'Alquiler', categoria_id: 3, metodo_pago: 'transferencia', comprobante: 'FAC-A-0001-00000301',
    proveedor: null, nota: null, anulado: false, anulado_motivo: null, turno_caja_id: null, programado: true,
  },
  {
    id: 500, fecha: '2026-10-07 18:05', monto: 12500, concepto: 'Compra de bolsas y film',
    categoria: 'Insumos', categoria_id: 1, metodo_pago: 'efectivo', comprobante: null,
    proveedor: 'Distribuidora Norte', nota: null, anulado: false, anulado_motivo: null, turno_caja_id: 55, programado: false,
  },
  {
    id: 499, fecha: '2026-10-05 11:20', monto: 42000, concepto: 'Luz (Edesur)',
    categoria: 'Servicios', categoria_id: 2, metodo_pago: 'debito', comprobante: 'FAC-B-0002-00000199',
    proveedor: null, nota: null, anulado: false, anulado_motivo: null, turno_caja_id: null, programado: true,
  },
  {
    id: 498, fecha: '2026-09-30 16:45', monto: 9000, concepto: 'Fletes de mercadería',
    categoria: 'Logística', categoria_id: 4, metodo_pago: 'efectivo', comprobante: 'REM-0000123',
    proveedor: 'Fletes Sur', nota: 'Reparto zona sur', anulado: false, anulado_motivo: null, turno_caja_id: null, programado: false,
  },
];

/** Registro interno de un producto (insumo del filtro; NO es la salida). */
interface RegistroProducto {
  id: number;
  nombre: string;
  codigo_interno: string;
  codigo_barras: string | null;
  categorias: string;
  categoria_id: number;
  marca: string | null;
  marca_id: number | null;
  cantidad: number;
  stock_minimo: number;
  unidad: string;
  precio_costo: number;
  precio_venta: number;
  activo: boolean;
  permitir_sin_stock: boolean;
  lote: string | null;
  fecha_vencimiento: string | null;
  presentaciones: Array<{ nombre: string; factor_conversion: number; activo: boolean }>;
}

/** Fila de lista de productos: claves exactas de `consultar_productos` (lista). */
interface FilaProducto {
  id: number;
  nombre: string;
  codigo_interno: string;
  categorias: string;
  marca: string | null;
  cantidad: number;
  stock_minimo: number;
  unidad: string;
  precio_costo: number;
  precio_venta: number;
  activo: boolean;
}

/** Detalle de producto: claves exactas de `consultar_productos` (detalle). */
interface DetalleProducto {
  id: number;
  nombre: string;
  codigo_interno: string;
  codigo_barras: string | null;
  categorias: string;
  marca: string | null;
  cantidad: number;
  stock_minimo: number;
  unidad: string;
  precio_costo: number;
  precio_venta: number;
  activo: boolean;
  permitir_sin_stock: boolean;
  lote: string | null;
  fecha_vencimiento: string | null;
  presentaciones: Array<{ nombre: string; factor_conversion: number; activo: boolean }>;
}

const PRODUCTOS_FIXTURE: RegistroProducto[] = [
  {
    id: 12, nombre: 'Coca-Cola 1.5L', codigo_interno: 'COCA15', codigo_barras: '7790895000123',
    categorias: 'Bebidas', categoria_id: 1, marca: 'Coca-Cola', marca_id: 5,
    cantidad: 3, stock_minimo: 10, unidad: 'u', precio_costo: 1900, precio_venta: 2500,
    activo: true, permitir_sin_stock: false, lote: null, fecha_vencimiento: null,
    presentaciones: [{ nombre: 'Pack x6', factor_conversion: 6, activo: true }],
  },
  {
    id: 13, nombre: 'Yerba 1kg', codigo_interno: 'YER1K', codigo_barras: '7791234567890',
    categorias: 'Almacén', categoria_id: 2, marca: 'Playadito', marca_id: 6,
    cantidad: 24, stock_minimo: 6, unidad: 'u', precio_costo: 6200, precio_venta: 7200,
    activo: true, permitir_sin_stock: false, lote: null, fecha_vencimiento: null, presentaciones: [],
  },
  {
    id: 14, nombre: 'Leche 1L', codigo_interno: 'LECH1L', codigo_barras: '7790070000142',
    categorias: 'Lácteos', categoria_id: 3, marca: 'La Serenísima', marca_id: 7,
    cantidad: 0, stock_minimo: 12, unidad: 'u', precio_costo: 700, precio_venta: 4300,
    activo: true, permitir_sin_stock: false, lote: 'L-2026-10', fecha_vencimiento: '2026-12-31', presentaciones: [],
  },
  {
    id: 15, nombre: 'Pan lactal', codigo_interno: 'PANLAC', codigo_barras: null,
    categorias: 'Panadería', categoria_id: 4, marca: null, marca_id: null,
    cantidad: 18, stock_minimo: 5, unidad: 'u', precio_costo: 2000, precio_venta: 3750,
    activo: false, permitir_sin_stock: true, lote: null, fecha_vencimiento: null, presentaciones: [],
  },
];

/** Registro interno de un movimiento de stock (insumo del filtro; NO es la salida). */
interface RegistroMovimiento {
  id: number;
  fecha: string;
  producto: string;
  producto_id: number;
  codigo_interno: string;
  tipo: string;
  cantidad: number;
  stock_resultante: number;
  nota: string | null;
  usuario: string;
}

/** Fila de lista de movimientos: claves exactas de `consultar_movimientos_stock` (lista). */
interface FilaMovimiento {
  id: number;
  fecha: string;
  producto: string;
  tipo: string;
  cantidad: number;
  nota: string | null;
  stock_resultante: number;
}

/** Detalle de movimiento: claves exactas de `consultar_movimientos_stock` (detalle). */
interface DetalleMovimiento {
  id: number;
  fecha: string;
  producto_id: number;
  producto: string;
  codigo_interno: string;
  tipo: string;
  cantidad: number;
  stock_resultante: number;
  nota: string | null;
  usuario: string;
}

const MOVIMIENTOS_FIXTURE: RegistroMovimiento[] = [
  {
    id: 3001, fecha: '2026-10-10 19:42', producto: 'Coca-Cola 1.5L', producto_id: 12,
    codigo_interno: 'COCA15', tipo: 'VENTA', cantidad: -2, stock_resultante: 3, nota: 'Venta 1240', usuario: 'Ana',
  },
  {
    id: 3000, fecha: '2026-10-09 10:15', producto: 'Coca-Cola 1.5L', producto_id: 12,
    codigo_interno: 'COCA15', tipo: 'COMPRA', cantidad: 24, stock_resultante: 5, nota: 'Compra 90', usuario: 'Ana',
  },
  {
    id: 2999, fecha: '2026-10-09 10:15', producto: 'Yerba 1kg', producto_id: 13,
    codigo_interno: 'YER1K', tipo: 'COMPRA', cantidad: 12, stock_resultante: 24, nota: 'Compra 90', usuario: 'Ana',
  },
  {
    id: 2998, fecha: '2026-10-08 12:00', producto: 'Leche 1L', producto_id: 14,
    codigo_interno: 'LECH1L', tipo: 'AJUSTE_DE_STOCK', cantidad: -60, stock_resultante: 0, nota: 'Ajuste por vencimiento', usuario: 'Beto',
  },
];

// --- Operaciones F3: presupuestos, clientes, proveedores y turnos de caja ---
// Mismo criterio: el builder vive en el desktop; acá se emula la salida del
// contrato (lista con envoltorio, detalle con `detalle`) respetando filtros/orden.

/** Registro interno de un presupuesto (insumo del filtro; NO es la salida). */
interface RegistroPresupuesto {
  id: number;
  numero: number;
  fecha: string;
  cliente: string;
  cliente_id: number;
  usuario: string;
  estado: string;
  total: number;
  descuento: number;
  recargo: number;
  recargo_concepto: string | null;
  validez_dias: number;
  vencimiento: string;
  nota: string | null;
  convertido: boolean;
  venta_id: number | null;
  items: Array<{ producto: string; cantidad: number; precio_unitario: number; subtotal: number }>;
}

/** Fila de lista de presupuestos: claves exactas de `consultar_presupuestos` (lista). */
interface FilaPresupuesto {
  id: number;
  fecha: string;
  cliente: string;
  total: number;
  estado: string;
  vencimiento: string;
  validez_dias: number;
  cantidad_items: number;
}

/** Detalle de presupuesto: claves exactas de `consultar_presupuestos` (detalle). */
interface DetallePresupuesto {
  id: number;
  numero: number;
  fecha: string;
  vencimiento: string;
  validez_dias: number;
  estado: string;
  cliente: string;
  usuario: string;
  total: number;
  descuento: number;
  recargo: number;
  recargo_concepto: string | null;
  nota: string | null;
  convertido: boolean;
  venta_id: number | null;
  items: Array<{ producto: string; cantidad: number; precio_unitario: number; subtotal: number }>;
}

const PRESUPUESTOS_FIXTURE: RegistroPresupuesto[] = [
  {
    id: 210, numero: 45, fecha: '2026-10-08 11:00', cliente: 'María López', cliente_id: 7,
    usuario: 'Ana', estado: 'pendiente', total: 15200, descuento: 0, recargo: 0, recargo_concepto: null,
    validez_dias: 15, vencimiento: '2026-10-23', nota: null, convertido: false, venta_id: null,
    items: [
      { producto: 'Yerba 1kg', cantidad: 2, precio_unitario: 6200, subtotal: 12400 },
      { producto: 'Azúcar 1kg', cantidad: 1, precio_unitario: 2800, subtotal: 2800 },
    ],
  },
  {
    id: 209, numero: 44, fecha: '2026-10-06 17:30', cliente: 'Juan Pérez', cliente_id: 12,
    usuario: 'Beto', estado: 'aprobado', total: 9800, descuento: 0, recargo: 0, recargo_concepto: null,
    validez_dias: 10, vencimiento: '2026-10-16', nota: null, convertido: true, venta_id: 1237,
    items: [{ producto: 'Fernet Branca 750ml', cantidad: 1, precio_unitario: 9800, subtotal: 9800 }],
  },
  {
    id: 208, numero: 43, fecha: '2026-10-01 10:00', cliente: 'Consumidor Final', cliente_id: 0,
    usuario: 'Ana', estado: 'vencido', total: 4300, descuento: 0, recargo: 0, recargo_concepto: null,
    validez_dias: 7, vencimiento: '2026-10-08', nota: null, convertido: false, venta_id: null,
    items: [{ producto: 'Leche 1L', cantidad: 1, precio_unitario: 4300, subtotal: 4300 }],
  },
];

/** Movimiento de cuenta corriente de un cliente (anidado en el detalle). */
interface MovimientoCliente {
  id: number;
  fecha: string;
  tipo: string;
  monto: number;
  saldo_posterior: number;
  concepto: string;
  metodo_pago: string | null;
  anulado: boolean;
}

/** Registro interno de un cliente (insumo del filtro; NO es la salida). */
interface RegistroCliente {
  id: number;
  nombre: string;
  razon_social: string | null;
  documento: string | null;
  telefono: string | null;
  celular: string | null;
  email: string | null;
  direccion: string | null;
  localidad: string | null;
  condicion_iva: string | null;
  saldo_actual: number;
  limite_credito: number;
  permite_credito: boolean;
  activo: boolean;
  nota: string | null;
  ultimo_movimiento: string | null;
  movimientos: MovimientoCliente[];
}

/** Fila de lista de clientes: claves exactas de `consultar_clientes` (lista). */
interface FilaCliente {
  id: number;
  nombre: string;
  documento: string | null;
  telefono: string | null;
  saldo_actual: number;
  limite_credito: number;
  ultimo_movimiento: string | null;
  activo: boolean;
}

/** Detalle de cliente: claves exactas de `consultar_clientes` (detalle). */
interface DetalleCliente {
  id: number;
  nombre: string;
  razon_social: string | null;
  documento: string | null;
  telefono: string | null;
  celular: string | null;
  email: string | null;
  direccion: string | null;
  localidad: string | null;
  condicion_iva: string | null;
  limite_credito: number;
  permite_credito: boolean;
  saldo_actual: number;
  nota: string | null;
  activo: boolean;
  movimientos: MovimientoCliente[];
}

const CLIENTES_FIXTURE: RegistroCliente[] = [
  {
    id: 7, nombre: 'María López', razon_social: null, documento: '27456789',
    telefono: '11-5555-1234', celular: '11-6666-1234', email: 'maria@mail.com',
    direccion: 'Av. Siempreviva 742', localidad: 'CABA', condicion_iva: 'consumidor_final',
    saldo_actual: 45000, limite_credito: 50000, permite_credito: true, activo: true, nota: null,
    ultimo_movimiento: '2026-10-10 18:15',
    movimientos: [{ id: 9001, fecha: '2026-10-10 18:15', tipo: 'cargo', concepto: 'Venta 1239', monto: 15200, saldo_posterior: 45000, metodo_pago: 'cuenta_corriente', anulado: false }],
  },
  {
    id: 12, nombre: 'Juan Pérez', razon_social: null, documento: '30123456',
    telefono: '11-5555-9876', celular: null, email: null,
    direccion: null, localidad: null, condicion_iva: 'consumidor_final',
    saldo_actual: 75000, limite_credito: 80000, permite_credito: true, activo: true, nota: null,
    ultimo_movimiento: '2026-10-09 20:10',
    movimientos: [{ id: 9002, fecha: '2026-10-09 20:10', tipo: 'cargo', concepto: 'Venta 1237', monto: 9800, saldo_posterior: 75000, metodo_pago: 'cuenta_corriente', anulado: false }],
  },
  {
    id: 20, nombre: 'Carlos Gómez', razon_social: null, documento: null,
    telefono: null, celular: null, email: null,
    direccion: null, localidad: null, condicion_iva: null,
    saldo_actual: 0, limite_credito: 0, permite_credito: false, activo: false, nota: null,
    ultimo_movimiento: null,
    movimientos: [],
  },
];

/** Compra de un proveedor (anidada en el detalle). */
interface CompraProveedor {
  id: number;
  fecha: string;
  total: number;
  numero_comprobante: string | null;
}

/** Registro interno de un proveedor (insumo del filtro; NO es la salida). */
interface RegistroProveedor {
  id: number;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  nota: string | null;
  activo: boolean;
  cantidad_compras: number;
  compras: CompraProveedor[];
}

/** Fila de lista de proveedores: claves exactas de `consultar_proveedores` (lista). */
interface FilaProveedor {
  id: number;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: boolean;
  cantidad_compras: number;
}

/** Detalle de proveedor: claves exactas de `consultar_proveedores` (detalle). */
interface DetalleProveedor {
  id: number;
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  nota: string | null;
  activo: boolean;
  compras: CompraProveedor[];
}

const PROVEEDORES_FIXTURE: RegistroProveedor[] = [
  {
    id: 1, nombre: 'Distribuidora Norte', telefono: '11-4444-1111', email: 'ventas@norte.com',
    direccion: 'Av. Rivadavia 1000', nota: null, activo: true, cantidad_compras: 2,
    compras: [
      { id: 90, fecha: '2026-10-09 10:15', total: 156000, numero_comprobante: 'FC-A-0001-00000123' },
      { id: 88, fecha: '2026-09-28 11:20', total: 38000, numero_comprobante: 'FC-A-0001-00000118' },
    ],
  },
  {
    id: 2, nombre: 'Lácteos del Sur', telefono: '11-4444-2222', email: null,
    direccion: null, nota: null, activo: true, cantidad_compras: 1,
    compras: [{ id: 89, fecha: '2026-10-05 09:40', total: 42000, numero_comprobante: 'FC-B-0002-00000045' }],
  },
  {
    id: 3, nombre: 'Bebidas Oeste', telefono: null, email: null,
    direccion: null, nota: null, activo: false, cantidad_compras: 0,
    compras: [],
  },
];

/** Retiro de caja de un turno (anidado en el detalle). */
interface RetiroTurno {
  fecha: string;
  usuario: string;
  monto: number;
  motivo: string;
}

/** Total cobrado por medio de pago en un turno (anidado en el detalle). */
interface TotalPorMedio {
  metodo: string;
  monto: number;
}

/** Registro interno de un turno de caja (insumo del filtro; NO es la salida). */
interface RegistroTurno {
  id: number;
  apertura: string;
  cierre: string | null;
  usuario: string;
  usuario_id: number;
  estado: string;
  monto_inicial: number;
  monto_contado: number | null;
  efectivo_esperado: number;
  diferencia: number | null;
  cantidad_ventas: number;
  observaciones_cierre: string | null;
  retiros: RetiroTurno[];
  totales_por_medio: TotalPorMedio[];
}

/** Fila de lista de turnos: claves exactas de `consultar_turnos_caja` (lista). */
interface FilaTurno {
  id: number;
  apertura: string;
  cierre: string | null;
  usuario: string;
  monto_inicial: number;
  monto_contado: number | null;
  diferencia: number | null;
  estado: string;
  cantidad_ventas: number;
}

/** Detalle de turno: claves exactas de `consultar_turnos_caja` (detalle). */
interface DetalleTurno {
  id: number;
  apertura: string;
  cierre: string | null;
  usuario: string;
  monto_inicial: number;
  monto_contado: number | null;
  efectivo_esperado: number;
  diferencia: number | null;
  estado: string;
  cantidad_ventas: number;
  observaciones_cierre: string | null;
  retiros: RetiroTurno[];
  totales_por_medio: TotalPorMedio[];
}

const TURNOS_FIXTURE: RegistroTurno[] = [
  {
    id: 55, apertura: '2026-10-10 08:00', cierre: null, usuario: 'Ana', usuario_id: 2,
    estado: 'abierto', monto_inicial: 5000, monto_contado: null, efectivo_esperado: 87000, diferencia: null,
    cantidad_ventas: 2, observaciones_cierre: null, retiros: [],
    totales_por_medio: [{ metodo: 'efectivo', monto: 82000 }, { metodo: 'debito', monto: 5000 }],
  },
  {
    id: 54, apertura: '2026-10-09 08:00', cierre: '2026-10-09 21:00', usuario: 'Beto', usuario_id: 3,
    estado: 'cerrado', monto_inicial: 5000, monto_contado: 45000, efectivo_esperado: 45000, diferencia: 0,
    cantidad_ventas: 1, observaciones_cierre: null,
    retiros: [{ fecha: '2026-10-09 15:00', usuario: 'Beto', monto: 10000, motivo: 'Retiro parcial' }],
    totales_por_medio: [{ metodo: 'efectivo', monto: 50000 }],
  },
  {
    id: 53, apertura: '2026-10-08 08:00', cierre: '2026-10-08 20:30', usuario: 'Ana', usuario_id: 2,
    estado: 'cerrado', monto_inicial: 5000, monto_contado: 38000, efectivo_esperado: 38500, diferencia: -500,
    cantidad_ventas: 1, observaciones_cierre: 'Faltante de $500',
    retiros: [],
    totales_por_medio: [{ metodo: 'efectivo', monto: 43000 }],
  },
];

// --- Proyecciones: registro interno → forma EXACTA del producto ---
// La lista del contrato proyecta un subconjunto; el detalle, el registro completo.

function proyectarVentaFila(v: RegistroVenta): FilaVenta {
  const medios = [...new Set(v.pagos.map((p) => p.metodo))].join(' + ');
  return {
    id: v.id,
    fecha: v.fecha,
    total: v.total,
    cliente: v.cliente,
    usuario: v.usuario,
    medios_pago: medios,
    cantidad_items: v.items.length,
  };
}

function proyectarVentaDetalle(v: RegistroVenta): DetalleVenta {
  return {
    id: v.id,
    fecha: v.fecha,
    total: v.total,
    estado: v.estado,
    cliente: v.cliente,
    usuario: v.usuario,
    nota: v.nota,
    items: v.items,
    pagos: v.pagos,
  };
}

function proyectarCompraFila(c: RegistroCompra): FilaCompra {
  return {
    id: c.id,
    fecha: c.fecha,
    proveedor: c.proveedor,
    total: c.total,
    cantidad_items: c.items.length,
  };
}

function proyectarCompraDetalle(c: RegistroCompra): DetalleCompra {
  return {
    id: c.id,
    fecha: c.fecha,
    proveedor: c.proveedor,
    total: c.total,
    anulada: c.anulada,
    numero_comprobante: c.numero_comprobante,
    nota: c.nota,
    items: c.items,
  };
}

function proyectarGastoFila(g: RegistroGasto): FilaGasto {
  return {
    id: g.id,
    fecha: g.fecha,
    concepto: g.concepto,
    monto: g.monto,
    categoria: g.categoria,
    metodo_pago: g.metodo_pago,
    comprobante: g.comprobante,
  };
}

function proyectarGastoDetalle(g: RegistroGasto): DetalleGasto {
  return {
    id: g.id,
    fecha: g.fecha,
    concepto: g.concepto,
    monto: g.monto,
    categoria: g.categoria,
    metodo_pago: g.metodo_pago,
    comprobante: g.comprobante,
    proveedor: g.proveedor,
    nota: g.nota,
    anulado: g.anulado,
    anulado_motivo: g.anulado_motivo,
    atado_a_turno: g.turno_caja_id !== null,
    turno_caja_id: g.turno_caja_id,
  };
}

function proyectarProductoFila(p: RegistroProducto): FilaProducto {
  return {
    id: p.id,
    nombre: p.nombre,
    codigo_interno: p.codigo_interno,
    categorias: p.categorias,
    marca: p.marca,
    cantidad: p.cantidad,
    stock_minimo: p.stock_minimo,
    unidad: p.unidad,
    precio_costo: p.precio_costo,
    precio_venta: p.precio_venta,
    activo: p.activo,
  };
}

function proyectarProductoDetalle(p: RegistroProducto): DetalleProducto {
  return {
    id: p.id,
    nombre: p.nombre,
    codigo_interno: p.codigo_interno,
    codigo_barras: p.codigo_barras,
    categorias: p.categorias,
    marca: p.marca,
    cantidad: p.cantidad,
    stock_minimo: p.stock_minimo,
    unidad: p.unidad,
    precio_costo: p.precio_costo,
    precio_venta: p.precio_venta,
    activo: p.activo,
    permitir_sin_stock: p.permitir_sin_stock,
    lote: p.lote,
    fecha_vencimiento: p.fecha_vencimiento,
    presentaciones: p.presentaciones,
  };
}

function proyectarMovimientoFila(m: RegistroMovimiento): FilaMovimiento {
  return {
    id: m.id,
    fecha: m.fecha,
    producto: m.producto,
    tipo: m.tipo,
    cantidad: m.cantidad,
    nota: m.nota,
    stock_resultante: m.stock_resultante,
  };
}

function proyectarMovimientoDetalle(m: RegistroMovimiento): DetalleMovimiento {
  return {
    id: m.id,
    fecha: m.fecha,
    producto_id: m.producto_id,
    producto: m.producto,
    codigo_interno: m.codigo_interno,
    tipo: m.tipo,
    cantidad: m.cantidad,
    stock_resultante: m.stock_resultante,
    nota: m.nota,
    usuario: m.usuario,
  };
}

function proyectarPresupuestoFila(p: RegistroPresupuesto): FilaPresupuesto {
  return {
    id: p.id,
    fecha: p.fecha,
    cliente: p.cliente,
    total: p.total,
    estado: p.estado,
    vencimiento: p.vencimiento,
    validez_dias: p.validez_dias,
    cantidad_items: p.items.length,
  };
}

function proyectarPresupuestoDetalle(p: RegistroPresupuesto): DetallePresupuesto {
  return {
    id: p.id,
    numero: p.numero,
    fecha: p.fecha,
    vencimiento: p.vencimiento,
    validez_dias: p.validez_dias,
    estado: p.estado,
    cliente: p.cliente,
    usuario: p.usuario,
    total: p.total,
    descuento: p.descuento,
    recargo: p.recargo,
    recargo_concepto: p.recargo_concepto,
    nota: p.nota,
    convertido: p.convertido,
    venta_id: p.venta_id,
    items: p.items,
  };
}

function proyectarClienteFila(c: RegistroCliente): FilaCliente {
  return {
    id: c.id,
    nombre: c.nombre,
    documento: c.documento,
    telefono: c.telefono,
    saldo_actual: c.saldo_actual,
    limite_credito: c.limite_credito,
    ultimo_movimiento: c.ultimo_movimiento,
    activo: c.activo,
  };
}

function proyectarClienteDetalle(c: RegistroCliente): DetalleCliente {
  return {
    id: c.id,
    nombre: c.nombre,
    razon_social: c.razon_social,
    documento: c.documento,
    telefono: c.telefono,
    celular: c.celular,
    email: c.email,
    direccion: c.direccion,
    localidad: c.localidad,
    condicion_iva: c.condicion_iva,
    limite_credito: c.limite_credito,
    permite_credito: c.permite_credito,
    saldo_actual: c.saldo_actual,
    nota: c.nota,
    activo: c.activo,
    movimientos: c.movimientos,
  };
}

function proyectarProveedorFila(p: RegistroProveedor): FilaProveedor {
  return {
    id: p.id,
    nombre: p.nombre,
    telefono: p.telefono,
    email: p.email,
    direccion: p.direccion,
    activo: p.activo,
    cantidad_compras: p.cantidad_compras,
  };
}

function proyectarProveedorDetalle(p: RegistroProveedor): DetalleProveedor {
  return {
    id: p.id,
    nombre: p.nombre,
    telefono: p.telefono,
    email: p.email,
    direccion: p.direccion,
    nota: p.nota,
    activo: p.activo,
    compras: p.compras,
  };
}

function proyectarTurnoFila(t: RegistroTurno): FilaTurno {
  return {
    id: t.id,
    apertura: t.apertura,
    cierre: t.cierre,
    usuario: t.usuario,
    monto_inicial: t.monto_inicial,
    monto_contado: t.monto_contado,
    diferencia: t.diferencia,
    estado: t.estado,
    cantidad_ventas: t.cantidad_ventas,
  };
}

function proyectarTurnoDetalle(t: RegistroTurno): DetalleTurno {
  return {
    id: t.id,
    apertura: t.apertura,
    cierre: t.cierre,
    usuario: t.usuario,
    monto_inicial: t.monto_inicial,
    monto_contado: t.monto_contado,
    efectivo_esperado: t.efectivo_esperado,
    diferencia: t.diferencia,
    estado: t.estado,
    cantidad_ventas: t.cantidad_ventas,
    observaciones_cierre: t.observaciones_cierre,
    retiros: t.retiros,
    totales_por_medio: t.totales_por_medio,
  };
}

function isoFecha(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Resuelve el rango del contrato: `desde`/`hasta` explícitos o `periodo` por nombre. */
function rangoResuelto(args: Record<string, unknown>): { desde: string; hasta: string } {
  const hoy = new Date();
  const hasta = isoFecha(hoy);
  const d = new Date(hoy);
  switch (args.periodo) {
    case 'hoy':
      return { desde: hasta, hasta };
    case 'ayer':
      d.setDate(d.getDate() - 1);
      return { desde: isoFecha(d), hasta: isoFecha(d) };
    case 'semana':
      d.setDate(d.getDate() - 6);
      return { desde: isoFecha(d), hasta };
    case 'semana_pasada': {
      const fin = new Date(hoy);
      fin.setDate(fin.getDate() - 7);
      const ini = new Date(fin);
      ini.setDate(ini.getDate() - 6);
      return { desde: isoFecha(ini), hasta: isoFecha(fin) };
    }
    case 'mes':
      d.setDate(1);
      return { desde: isoFecha(d), hasta };
    case 'mes_pasado': {
      const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      return { desde: isoFecha(ini), hasta: isoFecha(fin) };
    }
    case 'ultimos_7':
      d.setDate(d.getDate() - 6);
      return { desde: isoFecha(d), hasta };
    case 'ultimos_30':
      d.setDate(d.getDate() - 29);
      return { desde: isoFecha(d), hasta };
    case 'ultimos_90':
      d.setDate(d.getDate() - 89);
      return { desde: isoFecha(d), hasta };
    case 'todo':
      return { desde: '2000-01-01', hasta };
    default:
      return {
        desde: typeof args.desde === 'string' ? args.desde : '2000-01-01',
        hasta: typeof args.hasta === 'string' ? args.hasta : hasta,
      };
  }
}

function ordenarFilas<T extends { fecha: string; total: number }>(filas: T[], orden: unknown): T[] {
  const copia = [...filas];
  switch (orden) {
    case 'fecha_asc':
      copia.sort((a, b) => a.fecha.localeCompare(b.fecha));
      break;
    case 'total_desc':
      copia.sort((a, b) => b.total - a.total);
      break;
    case 'total_asc':
      copia.sort((a, b) => a.total - b.total);
      break;
    case 'fecha_desc':
    default:
      copia.sort((a, b) => b.fecha.localeCompare(a.fecha));
      break;
  }
  return copia;
}

/** Gastos ordenan por `monto` (la fila del contrato no expone `total`). */
function ordenarGastos<T extends { fecha: string; monto: number }>(filas: T[], orden: unknown): T[] {
  const copia = [...filas];
  switch (orden) {
    case 'fecha_asc':
      copia.sort((a, b) => a.fecha.localeCompare(b.fecha));
      break;
    case 'total_desc':
      copia.sort((a, b) => b.monto - a.monto);
      break;
    case 'total_asc':
      copia.sort((a, b) => a.monto - b.monto);
      break;
    case 'fecha_desc':
    default:
      copia.sort((a, b) => b.fecha.localeCompare(a.fecha));
      break;
  }
  return copia;
}

function limiteValido(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 50;
  return Math.min(200, Math.max(1, Math.trunc(n)));
}

function coincideBuscar(args: Record<string, unknown>, textos: string[]): boolean {
  if (typeof args.buscar !== 'string' || !args.buscar.trim()) return true;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = norm(args.buscar.trim());
  return textos.some((t) => norm(t).includes(q));
}

/** Salida de lista del contrato: total (sin recortar) + filas (recortadas). */
function salidaLista<T extends { fecha: string; total: number }>(
  operacion: string,
  filasFiltradas: T[],
  args: Record<string, unknown>,
): unknown {
  const orden = typeof args.orden === 'string' ? args.orden : 'fecha_desc';
  const limite = limiteValido(args.limite);
  const ordenadas = ordenarFilas(filasFiltradas, orden);
  return {
    operacion,
    simulado: true,
    limitacion: LIMITACION_SIMULADO,
    periodo_resuelto: rangoResuelto(args),
    filtros: { orden, limite, ...(args.incluir_anuladas === true ? { incluir_anuladas: true } : {}) },
    total: ordenadas.length,
    filas: ordenadas.slice(0, limite),
  };
}

/**
 * Salida de lista genérica: igual que `salidaLista` pero con un ordenador por
 * entidad (productos ordenan por nombre/cantidad; movimientos por fecha/cantidad).
 */
function salidaListaOrdenada<T>(
  operacion: string,
  filasFiltradas: T[],
  args: Record<string, unknown>,
  ordenar: (filas: T[], orden: string) => T[],
  ordenDefault: string,
): unknown {
  const orden = typeof args.orden === 'string' ? args.orden : ordenDefault;
  const limite = limiteValido(args.limite);
  const ordenadas = ordenar(filasFiltradas, orden);
  return {
    operacion,
    simulado: true,
    limitacion: LIMITACION_SIMULADO,
    periodo_resuelto: rangoResuelto(args),
    filtros: { orden, limite, ...(args.incluir_anuladas === true ? { incluir_anuladas: true } : {}) },
    total: ordenadas.length,
    filas: ordenadas.slice(0, limite),
  };
}

function ordenarProductos<T extends { nombre: string; cantidad: number }>(filas: T[], orden: string): T[] {
  const copia = [...filas];
  switch (orden) {
    case 'nombre_desc':
      copia.sort((a, b) => b.nombre.localeCompare(a.nombre));
      break;
    case 'cantidad_desc':
      copia.sort((a, b) => b.cantidad - a.cantidad);
      break;
    case 'cantidad_asc':
      copia.sort((a, b) => a.cantidad - b.cantidad);
      break;
    case 'nombre_asc':
    default:
      copia.sort((a, b) => a.nombre.localeCompare(b.nombre));
      break;
  }
  return copia;
}

function ordenarMovimientos<T extends { fecha: string; cantidad: number }>(filas: T[], orden: string): T[] {
  const copia = [...filas];
  switch (orden) {
    case 'fecha_asc':
      copia.sort((a, b) => a.fecha.localeCompare(b.fecha));
      break;
    case 'cantidad_desc':
      copia.sort((a, b) => b.cantidad - a.cantidad);
      break;
    case 'cantidad_asc':
      copia.sort((a, b) => a.cantidad - b.cantidad);
      break;
    case 'fecha_desc':
    default:
      copia.sort((a, b) => b.fecha.localeCompare(a.fecha));
      break;
  }
  return copia;
}

function ordenarClientes<T extends { nombre: string; saldo_actual: number }>(filas: T[], orden: string): T[] {
  const copia = [...filas];
  switch (orden) {
    case 'nombre_desc':
      copia.sort((a, b) => b.nombre.localeCompare(a.nombre));
      break;
    case 'saldo_desc':
      copia.sort((a, b) => b.saldo_actual - a.saldo_actual);
      break;
    case 'saldo_asc':
      copia.sort((a, b) => a.saldo_actual - b.saldo_actual);
      break;
    case 'nombre_asc':
    default:
      copia.sort((a, b) => a.nombre.localeCompare(b.nombre));
      break;
  }
  return copia;
}

function ordenarProveedores<T extends { nombre: string }>(filas: T[], orden: string): T[] {
  const copia = [...filas];
  switch (orden) {
    case 'nombre_desc':
      copia.sort((a, b) => b.nombre.localeCompare(a.nombre));
      break;
    case 'nombre_asc':
    default:
      copia.sort((a, b) => a.nombre.localeCompare(b.nombre));
      break;
  }
  return copia;
}

function ordenarTurnos<T extends { apertura: string }>(filas: T[], orden: string): T[] {
  const copia = [...filas];
  switch (orden) {
    case 'fecha_asc':
      copia.sort((a, b) => a.apertura.localeCompare(b.apertura));
      break;
    case 'fecha_desc':
    default:
      copia.sort((a, b) => b.apertura.localeCompare(a.apertura));
      break;
  }
  return copia;
}

function simularConsultarVentas(args: Record<string, unknown>): unknown {
  const id = args.id !== undefined ? Number(args.id) : undefined;
  if (id !== undefined) {
    const registro = VENTAS_FIXTURE.find((v) => v.id === id);
    if (!registro) {
      return { operacion: 'consultar_ventas', detalle: null, error: `No encontré la venta con id ${id}.` };
    }
    return { operacion: 'consultar_ventas', simulado: true, limitacion: LIMITACION_SIMULADO, detalle: proyectarVentaDetalle(registro) };
  }
  const incluirAnuladas = args.incluir_anuladas === true;
  let registros = VENTAS_FIXTURE.filter((v) => incluirAnuladas || !v.anulada);
  registros = registros.filter((v) =>
    coincideBuscar(args, [v.cliente, ...v.items.map((it) => it.producto)]),
  );
  if (args.medio_pago !== undefined) registros = registros.filter((v) => v.medio_pago === args.medio_pago);
  if (args.cliente_id !== undefined) registros = registros.filter((v) => v.cliente_id === Number(args.cliente_id));
  if (args.usuario_id !== undefined) registros = registros.filter((v) => v.usuario_id === Number(args.usuario_id));
  if (args.turno_id !== undefined) registros = registros.filter((v) => v.turno_id === Number(args.turno_id));
  return salidaLista('consultar_ventas', registros.map(proyectarVentaFila), args);
}

function simularConsultarCompras(args: Record<string, unknown>): unknown {
  const id = args.id !== undefined ? Number(args.id) : undefined;
  if (id !== undefined) {
    const registro = COMPRAS_FIXTURE.find((c) => c.id === id);
    if (!registro) {
      return { operacion: 'consultar_compras', detalle: null, error: `No encontré la compra con id ${id}.` };
    }
    return { operacion: 'consultar_compras', simulado: true, limitacion: LIMITACION_SIMULADO, detalle: proyectarCompraDetalle(registro) };
  }
  let registros = COMPRAS_FIXTURE;
  registros = registros.filter((c) =>
    coincideBuscar(args, [c.proveedor, ...c.items.map((it) => it.producto)]),
  );
  if (args.proveedor_id !== undefined) registros = registros.filter((c) => c.proveedor_id === Number(args.proveedor_id));
  return salidaLista('consultar_compras', registros.map(proyectarCompraFila), args);
}

function simularConsultarGastos(args: Record<string, unknown>): unknown {
  const id = args.id !== undefined ? Number(args.id) : undefined;
  if (id !== undefined) {
    const registro = GASTOS_FIXTURE.find((g) => g.id === id);
    if (!registro) {
      return { operacion: 'consultar_gastos', detalle: null, error: `No encontré el gasto con id ${id}.` };
    }
    return { operacion: 'consultar_gastos', simulado: true, limitacion: LIMITACION_SIMULADO, detalle: proyectarGastoDetalle(registro) };
  }
  let registros = [...GASTOS_FIXTURE];
  registros = registros.filter((g) => coincideBuscar(args, [g.concepto, g.categoria]));
  if (args.categoria_id !== undefined) registros = registros.filter((g) => g.categoria_id === Number(args.categoria_id));
  if (typeof args.metodo_pago === 'string') registros = registros.filter((g) => g.metodo_pago === args.metodo_pago);
  if (typeof args.programado === 'boolean') registros = registros.filter((g) => g.programado === args.programado);
  return salidaListaOrdenada('consultar_gastos', registros.map(proyectarGastoFila), args, ordenarGastos, 'fecha_desc');
}

function simularConsultarProductos(args: Record<string, unknown>): unknown {
  const id = args.id !== undefined ? Number(args.id) : undefined;
  if (id !== undefined) {
    const registro = PRODUCTOS_FIXTURE.find((p) => p.id === id);
    if (!registro) {
      return { operacion: 'consultar_productos', detalle: null, error: `No encontré el producto con id ${id}.` };
    }
    return { operacion: 'consultar_productos', simulado: true, limitacion: LIMITACION_SIMULADO, detalle: proyectarProductoDetalle(registro) };
  }
  let registros = [...PRODUCTOS_FIXTURE];
  registros = registros.filter((p) => coincideBuscar(args, [p.nombre, p.codigo_interno]));
  if (args.categoria_id !== undefined) registros = registros.filter((p) => p.categoria_id === Number(args.categoria_id));
  if (args.marca_id !== undefined) registros = registros.filter((p) => p.marca_id === Number(args.marca_id));
  if (typeof args.con_stock === 'boolean') registros = registros.filter((p) => (p.cantidad > 0) === args.con_stock);
  if (typeof args.bajo_minimo === 'boolean') registros = registros.filter((p) => (p.cantidad <= p.stock_minimo) === args.bajo_minimo);
  if (typeof args.activo === 'boolean') registros = registros.filter((p) => p.activo === args.activo);
  return salidaListaOrdenada('consultar_productos', registros.map(proyectarProductoFila), args, ordenarProductos, 'nombre_asc');
}

function simularConsultarMovimientosStock(args: Record<string, unknown>): unknown {
  const id = args.id !== undefined ? Number(args.id) : undefined;
  if (id !== undefined) {
    const registro = MOVIMIENTOS_FIXTURE.find((m) => m.id === id);
    if (!registro) {
      return { operacion: 'consultar_movimientos_stock', detalle: null, error: `No encontré el movimiento con id ${id}.` };
    }
    return { operacion: 'consultar_movimientos_stock', simulado: true, limitacion: LIMITACION_SIMULADO, detalle: proyectarMovimientoDetalle(registro) };
  }
  let registros = [...MOVIMIENTOS_FIXTURE];
  registros = registros.filter((m) => coincideBuscar(args, [m.producto, m.nota ?? '']));
  if (args.producto_id !== undefined) registros = registros.filter((m) => m.producto_id === Number(args.producto_id));
  if (typeof args.tipo === 'string' && args.tipo.trim()) {
    const t = args.tipo.trim().toLowerCase();
    registros = registros.filter((m) => m.tipo.toLowerCase() === t);
  }
  return salidaListaOrdenada('consultar_movimientos_stock', registros.map(proyectarMovimientoFila), args, ordenarMovimientos, 'fecha_desc');
}

function simularConsultarPresupuestos(args: Record<string, unknown>): unknown {
  const id = args.id !== undefined ? Number(args.id) : undefined;
  if (id !== undefined) {
    const registro = PRESUPUESTOS_FIXTURE.find((p) => p.id === id);
    if (!registro) {
      return { operacion: 'consultar_presupuestos', detalle: null, error: `No encontré el presupuesto con id ${id}.` };
    }
    return { operacion: 'consultar_presupuestos', simulado: true, limitacion: LIMITACION_SIMULADO, detalle: proyectarPresupuestoDetalle(registro) };
  }
  let registros = [...PRESUPUESTOS_FIXTURE];
  registros = registros.filter((p) => coincideBuscar(args, [p.cliente]));
  if (args.cliente_id !== undefined) registros = registros.filter((p) => p.cliente_id === Number(args.cliente_id));
  if (typeof args.estado === 'string' && args.estado.trim()) registros = registros.filter((p) => p.estado === args.estado);
  return salidaLista('consultar_presupuestos', registros.map(proyectarPresupuestoFila), args);
}

function simularConsultarClientes(args: Record<string, unknown>): unknown {
  const id = args.id !== undefined ? Number(args.id) : undefined;
  if (id !== undefined) {
    const registro = CLIENTES_FIXTURE.find((c) => c.id === id);
    if (!registro) {
      return { operacion: 'consultar_clientes', detalle: null, error: `No encontré el cliente con id ${id}.` };
    }
    return { operacion: 'consultar_clientes', simulado: true, limitacion: LIMITACION_SIMULADO, detalle: proyectarClienteDetalle(registro) };
  }
  let registros = [...CLIENTES_FIXTURE];
  registros = registros.filter((c) => coincideBuscar(args, [c.nombre, c.documento ?? '', c.telefono ?? '']));
  if (typeof args.con_deuda === 'boolean') registros = registros.filter((c) => (c.saldo_actual > 0) === args.con_deuda);
  if (typeof args.activo === 'boolean') registros = registros.filter((c) => c.activo === args.activo);
  return salidaListaOrdenada('consultar_clientes', registros.map(proyectarClienteFila), args, ordenarClientes, 'nombre_asc');
}

function simularConsultarProveedores(args: Record<string, unknown>): unknown {
  const id = args.id !== undefined ? Number(args.id) : undefined;
  if (id !== undefined) {
    const registro = PROVEEDORES_FIXTURE.find((p) => p.id === id);
    if (!registro) {
      return { operacion: 'consultar_proveedores', detalle: null, error: `No encontré el proveedor con id ${id}.` };
    }
    return { operacion: 'consultar_proveedores', simulado: true, limitacion: LIMITACION_SIMULADO, detalle: proyectarProveedorDetalle(registro) };
  }
  let registros = [...PROVEEDORES_FIXTURE];
  registros = registros.filter((p) => coincideBuscar(args, [p.nombre]));
  if (typeof args.activo === 'boolean') registros = registros.filter((p) => p.activo === args.activo);
  return salidaListaOrdenada('consultar_proveedores', registros.map(proyectarProveedorFila), args, ordenarProveedores, 'nombre_asc');
}

function simularConsultarTurnosCaja(args: Record<string, unknown>): unknown {
  const id = args.id !== undefined ? Number(args.id) : undefined;
  if (id !== undefined) {
    const registro = TURNOS_FIXTURE.find((t) => t.id === id);
    if (!registro) {
      return { operacion: 'consultar_turnos_caja', detalle: null, error: `No encontré el turno de caja con id ${id}.` };
    }
    return { operacion: 'consultar_turnos_caja', simulado: true, limitacion: LIMITACION_SIMULADO, detalle: proyectarTurnoDetalle(registro) };
  }
  let registros = [...TURNOS_FIXTURE];
  if (typeof args.estado === 'string' && args.estado.trim()) registros = registros.filter((t) => t.estado === args.estado);
  if (args.usuario_id !== undefined) registros = registros.filter((t) => t.usuario_id === Number(args.usuario_id));
  return salidaListaOrdenada('consultar_turnos_caja', registros.map(proyectarTurnoFila), args, ordenarTurnos, 'fecha_desc');
}

function resultadoSimulado(nombre: string, args: Record<string, unknown>): unknown {
  const base = { herramienta: nombre, simulado: true, limitacion: LIMITACION_SIMULADO };
  switch (nombre) {
    case 'consultar_ventas':
      return simularConsultarVentas(args);
    case 'consultar_compras':
      return simularConsultarCompras(args);
    case 'consultar_gastos':
      return simularConsultarGastos(args);
    case 'consultar_productos':
      return simularConsultarProductos(args);
    case 'consultar_movimientos_stock':
      return simularConsultarMovimientosStock(args);
    case 'consultar_presupuestos':
      return simularConsultarPresupuestos(args);
    case 'consultar_clientes':
      return simularConsultarClientes(args);
    case 'consultar_proveedores':
      return simularConsultarProveedores(args);
    case 'consultar_turnos_caja':
      return simularConsultarTurnosCaja(args);
    case 'guardar_memoria':
      return { ok: true, guardado: true, simulado: true };
    case 'simular_escenario':
      return { ...base, porcentaje: args.porcentaje ?? 10, tipo: args.tipo ?? 'precio', base_dias: 45, delta_facturacion: 12500, supuesto: 'volumen constante' };
    case 'predecir_reposicion':
      return { ...base, items: [{ producto: 'Coca-Cola 1.5L', reponer: 24, cobertura_dias: 5 }, { producto: 'Yerba 1kg', reponer: 10, cobertura_dias: 7 }] };
    case 'obtener_analitica_anomalias':
      return { ...base, anomalias: [{ tipo: 'ticket atipico', referencia: 'venta 1234' }] };
    case 'obtener_pildoras_oportunidad':
      return { ...base, oportunidades: [{ tipo: 'capital parado', producto: 'Vino reserva', monto: 38000 }] };
    case 'comparar_periodos':
      return { ...base, dias: args.dias ?? 30, ventas_actual: 120000, ventas_anterior: 100000, delta_porcentaje: 20, tickets_actual: 40, ticket_promedio_actual: 3000 };
    case 'obtener_analitica_abc':
      return { ...base, clases: { A: [{ producto: 'Coca-Cola', facturacion: 50000 }], B: [], C: [] } };
    case 'obtener_fugas_precio':
      return { ...base, fugas: [{ producto: 'Pan lactal', perdida: 2400, unidades: 12 }] };
    case 'comparar_cajeros':
      return { ...base, cajeros: [{ usuario: 'Ana', turnos: 8, diferencia_caja: 0, ticket_promedio: 3200 }] };
    case 'ultima_venta':
      return {
        ...base,
        venta: {
          id: 1234,
          fecha: '2026-10-10 19:42',
          total: 8750,
          items: [
            { producto: 'Coca-Cola 1.5L', cantidad: 2, precio_unitario: 2500, subtotal: 5000 },
            { producto: 'Pan lactal', cantidad: 1, precio_unitario: 3750, subtotal: 3750 },
          ],
          pagos: [{ metodo: 'efectivo', monto: 8750 }],
        },
      };
    case 'ultima_compra':
      return {
        ...base,
        compra: {
          id: 88,
          fecha: '2026-10-09 10:15',
          proveedor: 'Distribuidora Norte',
          total: 156000,
          items: [
            { producto: 'Coca-Cola 1.5L', cantidad: 24, precio_costo: 1900, subtotal: 45600 },
            { producto: 'Yerba 1kg', cantidad: 12, precio_costo: 6200, subtotal: 74400 },
          ],
        },
      };
    default:
      return { ...base, error: `herramienta desconocida: ${nombre}` };
  }
}

/** Mensaje que se le devuelve al modelo cuando una llamada a herramienta ilegible. */
const MENSAJE_LLAMADA_INVALIDA =
  'No pude interpretar esa llamada. Reintentá con el formato correcto de la herramienta.';

/** Errores del proveedor de los que el agente puede recuperarse reintentando. */
function esErrorRecuperable(texto: string): boolean {
  return /no pude interpretar la llamada|formato correcto/i.test(texto);
}

// --- Guarda (c) del desktop: el bloque `seguir` NUNCA reemplaza la respuesta ---
// Espeja `texto_solo_tiene_sugerencias` de src-tauri/src/chat.rs: si el texto
// final quedó con SOLO el bloque de sugerencias (o solo 2-4 líneas-pregunta
// sueltas), el desktop pide UNA redacción real antes de mostrarlo. El ejecutor
// replica esa guarda para no medir una burbuja que el producto nunca mostraría.

const INSTRUCCION_SOLO_SUGERENCIAS =
  'Redactá AHORA la respuesta al comerciante con los datos que ya obtuviste; si te falta el dato, consultalo con la herramienta antes de responder. Las sugerencias van después, no en lugar de la respuesta.';

const INICIOS_PREGUNTA_SEGUIR = [
  'como', 'que', 'cual', 'cuanto', 'cuantos', 'cuanta', 'cuando', 'donde',
  'quien', 'por que', 'para que', 'hay', 'tenes', 'podes', 'me conviene',
  'conviene', 'queres', 'mostrame', 'decime', 'dame', 'mostra',
];

/** ¿La línea parece una pregunta o pedido sugerido? (mismo criterio que el desktop). */
function esPreguntaSueltaDeSeguir(linea: string): boolean {
  const t = (linea ?? '').trim();
  if (t.length === 0 || t.length > 70) return false;
  if (/^(?:[-*•]|\d+[.)])(?:\s|$)/.test(t)) return false;
  if (t.startsWith('¿') || t.endsWith('?')) return true;
  const n = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return INICIOS_PREGUNTA_SEGUIR.some((p) => n.startsWith(p));
}

/** Quita un bloque ```seguir (completo o todavía abierto) del texto. */
function quitarBloqueSeguirAbierto(texto: string): string {
  const idx = (texto ?? '').toLowerCase().indexOf('```seguir');
  if (idx < 0) return texto;
  const antes = texto.slice(0, idx);
  const resto = texto.slice(idx);
  const cierre = resto.indexOf('```', '```seguir'.length);
  return cierre < 0 ? antes : antes + resto.slice(cierre + 3);
}

/** `true` cuando el texto final quedó con SOLO sugerencias y ninguna respuesta. */
function textoSoloTieneSugerencias(texto: string): boolean {
  const restante = quitarBloqueSeguirAbierto(texto ?? '').trim();
  if (restante.length === 0) return true;
  const lineas = restante.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lineas.length < 2 || lineas.length > 4) return false;
  return lineas.every(esPreguntaSueltaDeSeguir);
}

function resolverHerramienta(tc: AgenteToolCall): string {
  const crudo = (tc.argumentos ?? '').trim();
  let args: Record<string, unknown> = {};
  if (crudo) {
    let parseado: unknown;
    try {
      parseado = JSON.parse(crudo);
    } catch {
      // JSON malformado: NO morir; devolver el error para que el modelo reintente.
      return MENSAJE_LLAMADA_INVALIDA;
    }
    if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) {
      return MENSAJE_LLAMADA_INVALIDA;
    }
    args = parseado as Record<string, unknown>;
  }
  // Los motores deterministas viven en el desktop: acá se simulan. El modelo ya
  // no escribe SQL, así que no hay ninguna consulta que ejecutar.
  return JSON.stringify(resultadoSimulado(tc.nombre, args));
}

// --- Un turno del agente ---

interface TurnoAgente {
  texto: string;
  acumulado: string;
  toolCalls: AgenteToolCall[];
  error?: string;
}

async function llamarTurno(mensajes: AgenteMessage[], forzar: boolean): Promise<TurnoAgente> {
  let acumulado = '';
  let final: string | null = null;
  let toolCalls: AgenteToolCall[] = [];
  let error: string | undefined;
  const opciones = forzar
    ? { forzarRespuestaFinal: true, sinHerramientas: true, model: env.LLM_MODEL }
    : { model: env.LLM_MODEL };

  for await (const ev of llamarLLMAgenteStream(mensajes, HERRAMIENTAS_AGENTE, opciones)) {
    if (ev.type === 'chunk' && ev.texto) acumulado += ev.texto;
    else if (ev.type === 'done') final = ev.texto;
    else if (ev.type === 'herramienta') toolCalls = ev.tool_calls ?? [];
    else if (ev.type === 'error') error = ev.texto ?? 'error del proveedor';
  }
  return { texto: final ?? acumulado, acumulado, toolCalls, error };
}

// --- Corrida de un caso (repite todo el flujo real) ---

interface CorridaCaso {
  caso: CasoPruebaE2E;
  texto: string;
  resultado: ResultadoCasoE2E;
  pasos: number;
  herramientas: string[];
  /** Qué guarda determinística del producto modificó el texto (métrica). */
  disparos: DisparosGuardas;
  error?: string;
  ms: number;
}

const SIN_DISPAROS: DisparosGuardas = {
  normalizarSeguir: false,
  quitarNombresInternos: false,
  quitarBloquesTecnicos: false,
  quitarOfertaFinal: false,
  quitarDisculpas: false,
};

async function correrCaso(caso: CasoPruebaE2E): Promise<CorridaCaso> {
  const inicio = Date.now();
  const mensajes: AgenteMessage[] = [
    { role: 'system', content: construirPromptSistema('agente', CONTEXTO, caso.pregunta) },
  ];
  // Historial OPCIONAL del caso (retrocompatible): se inserta entre el prompt de
  // sistema y la pregunta, tal como lo hace `preguntarAgente` con `data.historial`.
  for (const m of caso.historial ?? []) {
    mensajes.push({ role: m.rol === 'asistente' ? 'assistant' : 'user', content: m.contenido });
  }
  mensajes.push({ role: 'user', content: caso.pregunta });
  let pasos = 0;
  let forzar = false;
  let textoFinal = '';
  let error: string | undefined;
  let reintentoSugerenciasHecho = false;
  const herramientas: string[] = [];

  try {
    while (true) {
      const turno = await llamarTurno(mensajes, forzar);
      if (turno.error) {
        // Una llamada a herramienta que el proveedor no pudo interpretar NO debe
        // matar la corrida: devolvemos un resultado de herramienta con el error y
        // seguimos el ciclo (hasta el tope de pasos).
        if (esErrorRecuperable(turno.error) && pasos < MAX_PASOS) {
          pasos++;
          const id = `llamada_invalida_${pasos}`;
          mensajes.push({
            role: 'assistant',
            content: turno.acumulado,
            tool_calls: [
              { id, type: 'function', function: { name: 'ultima_venta', arguments: '{}' } },
            ],
          });
          mensajes.push({
            role: 'tool',
            tool_call_id: id,
            name: 'ultima_venta',
            content: MENSAJE_LLAMADA_INVALIDA,
          });
          if (pasos >= MAX_PASOS) forzar = true;
          continue;
        }
        error = turno.error;
        break;
      }
      if (turno.toolCalls.length > 0 && !forzar) {
        pasos++;
        herramientas.push(...turno.toolCalls.map((t) => t.nombre));
        mensajes.push({
          role: 'assistant',
          content: turno.acumulado,
          tool_calls: turno.toolCalls.map((t) => ({
            id: t.id,
            type: 'function',
            function: { name: t.nombre, arguments: t.argumentos },
          })),
        });
        for (const tc of turno.toolCalls) {
          mensajes.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.nombre,
            content: resolverHerramienta(tc),
          });
        }
        if (pasos >= MAX_PASOS) forzar = true;
        continue;
      }
      textoFinal = turno.texto;
      // Guarda (c) del desktop: el bloque `seguir` NUNCA reemplaza la respuesta.
      // Si el modelo devolvió solo sugerencias (o nada), se pide UNA redacción
      // real más y se sigue el ciclo; recién si vuelve a fallar se corta.
      if (textoSoloTieneSugerencias(textoFinal) && !reintentoSugerenciasHecho) {
        reintentoSugerenciasHecho = true;
        mensajes.push({ role: 'assistant', content: textoFinal });
        mensajes.push({ role: 'user', content: INSTRUCCION_SOLO_SUGERENCIAS });
        continue;
      }
      break;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Sin texto final tras agotar los pasos: caso fallido explícito (no excepción).
  if (!textoFinal.trim()) {
    return {
      caso,
      texto: '',
      resultado: { id: caso.id, ok: false, fallas: ['sin-texto-final'], detalle: 'sin-texto-final' },
      pasos,
      herramientas,
      disparos: { ...SIN_DISPAROS },
      error,
      ms: Date.now() - inicio,
    };
  }

  // ESPEJO de guardas del producto: el texto que se evalúa es el que vería el
  // comerciante (no el crudo del modelo). `disparos` es solo métrica.
  const espejo = aplicarGuardasEspejo(textoFinal ?? '');
  const final = espejo.texto;
  const resultado = evaluarCasoE2E(final, caso);
  // Exigencia de OPERACIÓN: el caso puede requerir que se haya invocado una
  // operación tipada concreta (evita que una respuesta inventada pase como válida).
  if (
    caso.usaHerramienta &&
    caso.usaHerramienta.length > 0 &&
    !caso.usaHerramienta.some((h) => herramientas.includes(h))
  ) {
    resultado.ok = false;
    resultado.fallas.push(`no invocó la operación esperada (${caso.usaHerramienta.join(' | ')})`);
    resultado.detalle = resultado.fallas.join('; ');
  }
  return { caso, texto: final, resultado, pasos, herramientas, disparos: espejo.disparos, error, ms: Date.now() - inicio };
}

// --- Pool de concurrencia ---

async function correrConPool(tareas: Array<() => Promise<CorridaCaso>>, limite: number): Promise<CorridaCaso[]> {
  const resultados = new Array<CorridaCaso>(tareas.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= tareas.length) return;
      try {
        resultados[i] = await tareas[i]!();
      } catch (e) {
        // Nunca dejar huecos: una tarea que revienta se reporta como falla.
        resultados[i] = {
          caso: casosFiltrados[i]!,
          texto: '',
          resultado: { id: casosFiltrados[i]!.id, ok: false, fallas: ['excepción'], detalle: `excepción: ${e instanceof Error ? e.message : e}` },
          pasos: 0,
          herramientas: [],
          disparos: { ...SIN_DISPAROS },
          error: e instanceof Error ? e.message : String(e),
          ms: 0,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, () => worker()));
  return resultados;
}

// --- Reporte ---

function pct(ok: number, total: number): number {
  return total ? Math.round((ok / total) * 100) : 0;
}

// --- Estadísticas de latencia (ms por caso/corrida) ---

function promedio(valores: number[]): number {
  if (valores.length === 0) return 0;
  return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(orden.length / 2);
  return orden.length % 2 === 0
    ? Math.round((orden[mid - 1]! + orden[mid]!) / 2)
    : orden[mid]!;
}

/** Percentil por rango más cercano: `p` en (0,1]. */
function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const idx = Math.min(orden.length - 1, Math.max(0, Math.ceil(p * orden.length) - 1));
  return orden[idx]!;
}

/** Cuenta cuántas corridas dispararon cada guarda del espejo. */
function contarDisparos(corridas: CorridaCaso[]): Map<string, number> {
  const claves: Array<keyof DisparosGuardas> = [
    'normalizarSeguir',
    'quitarNombresInternos',
    'quitarBloquesTecnicos',
    'quitarOfertaFinal',
    'quitarDisculpas',
  ];
  const conteo = new Map<string, number>(claves.map((k) => [k, 0]));
  for (const c of corridas) {
    for (const k of claves) {
      if (c.disparos[k]) conteo.set(k, (conteo.get(k) ?? 0) + 1);
    }
  }
  return conteo;
}

function escribirReporte(corridas: CorridaCaso[], nota?: string): void {
  const total = corridas.length;
  const ok = corridas.filter((c) => c.resultado.ok).length;

  const porTipo = new Map<string, { ok: number; total: number }>();
  for (const c of corridas) {
    const acc = porTipo.get(c.caso.tipo) ?? { ok: 0, total: 0 };
    acc.total += 1;
    if (c.resultado.ok) acc.ok += 1;
    porTipo.set(c.caso.tipo, acc);
  }

  // Agrupado por caso (para --repes>1 reportar tasa por caso).
  const porCaso = new Map<string, CorridaCaso[]>();
  for (const c of corridas) {
    const arr = porCaso.get(c.caso.id) ?? [];
    arr.push(c);
    porCaso.set(c.caso.id, arr);
  }

  const lineas: string[] = [
    '# Prueba end-to-end de Binny (modo agente)',
    '',
    `Fecha: ${new Date().toISOString()}`,
    `Modelo: ${env.LLM_MODEL} · filtro: ${FILTRO ?? '(ninguno)'} · repes: ${REPES} · concurrencia: ${CONCURRENCIA}`,
    '',
    `## Resultado global: ${ok}/${total} (${pct(ok, total)}%)`,
    '',
  ];
  if (nota) lineas.push(`> ${nota}`, '');

  lineas.push('## Tasa por tipo', '');
  lineas.push('| tipo | pasa | total | % |');
  lineas.push('| --- | :-: | :-: | :-: |');
  for (const [tipo, acc] of porTipo) {
    lineas.push(`| ${tipo} | ${acc.ok} | ${acc.total} | ${pct(acc.ok, acc.total)}% |`);
  }
  lineas.push('');

  // --- Latencia (ms por caso/corrida) ---
  const duraciones = corridas.map((c) => c.ms);
  const masLentos = [...corridas].sort((a, b) => b.ms - a.ms).slice(0, 5);
  const msPorTipo = new Map<string, number[]>();
  for (const c of corridas) {
    const arr = msPorTipo.get(c.caso.tipo) ?? [];
    arr.push(c.ms);
    msPorTipo.set(c.caso.tipo, arr);
  }

  lineas.push('## Latencia (ms por caso)');
  lineas.push('');
  lineas.push(
    `- Promedio: **${promedio(duraciones)} ms** · Mediana: **${mediana(duraciones)} ms** · p95: **${percentil(duraciones, 0.95)} ms**`,
  );
  lineas.push(`- Casos medidos: ${duraciones.length}`);
  lineas.push('');
  lineas.push('### Los 5 más lentos');
  lineas.push('');
  lineas.push('| id | ms | pasos | herramientas |');
  lineas.push('| --- | :-: | :-: | --- |');
  for (const c of masLentos) {
    lineas.push(`| ${c.caso.id} | ${c.ms} | ${c.pasos} | ${c.herramientas.join(', ') || '—'} |`);
  }
  lineas.push('');
  lineas.push('### Latencia por tipo');
  lineas.push('');
  lineas.push('| tipo | promedio | mediana | p95 | casos |');
  lineas.push('| --- | :-: | :-: | :-: | :-: |');
  for (const [tipo, ms] of msPorTipo) {
    lineas.push(`| ${tipo} | ${promedio(ms)} ms | ${mediana(ms)} ms | ${percentil(ms, 0.95)} ms | ${ms.length} |`);
  }
  lineas.push('');

  // --- Disparos por guarda (informativo, no afecta la nota) ---
  const disparos = contarDisparos(corridas);
  lineas.push('## Disparos por guarda (informativo)');
  lineas.push('');
  lineas.push('Cuántas corridas modificó cada guarda determinística del espejo. No afecta la nota.');
  lineas.push('');
  lineas.push('| guarda | disparos | % |');
  lineas.push('| --- | :-: | :-: |');
  for (const [guarda, n] of disparos) {
    lineas.push(`| ${guarda} | ${n} | ${pct(n, total)}% |`);
  }
  lineas.push('');

  lineas.push('## Detalle por caso', '');
  lineas.push('| id | pregunta | resultado | qué falló |');
  lineas.push('| --- | --- | :-: | --- |');
  for (const [id, reps] of porCaso) {
    const okReps = reps.filter((r) => r.resultado.ok).length;
    const marca = okReps === reps.length ? '✓' : '✗';
    const tasa = REPES > 1 ? ` (${okReps}/${reps.length})` : '';
    const fallas = [...new Set(reps.flatMap((r) => r.resultado.fallas))];
    lineas.push(`| ${id} | ${reps[0]!.caso.pregunta} | ${marca}${tasa} | ${fallas.join('; ') || '—'} |`);
  }
  lineas.push('');

  const fallidas = corridas.filter((c) => !c.resultado.ok);
  if (fallidas.length > 0) {
    lineas.push('## Detalle de las fallas', '');
    for (const c of fallidas) {
      lineas.push(`### ${c.caso.id} — ${c.caso.pregunta}`);
      lineas.push('');
      lineas.push(`- **Qué falló:** ${c.resultado.detalle}`);
      if (c.error) lineas.push(`- **Error:** ${c.error}`);
      lineas.push(`- **Herramientas:** ${c.herramientas.join(', ') || '(ninguna)'} · pasos: ${c.pasos} · ${c.ms}ms`);
      const preview = c.texto.replace(/\s+/g, ' ').trim().slice(0, 300) || '(texto vacío)';
      lineas.push('');
      lineas.push(`> ${preview}`);
      lineas.push('');
    }
  }

  fs.mkdirSync(path.dirname(RUTA_REPORTE), { recursive: true });
  fs.writeFileSync(RUTA_REPORTE, lineas.join('\n'), 'utf8');
}

// --- Main ---

let casosFiltrados: CasoPruebaE2E[] = [];

async function main() {
  console.log('=== Prueba E2E de Binny (modo agente) ===');
  console.log(`Modelo: ${env.LLM_MODEL}`);
  console.log(`Corpus: ${CORPUS_PRUEBA_E2E.length} casos · repes=${REPES} · concurrencia=${CONCURRENCIA}`);

  if (!env.LLM_API_KEY) {
    console.error('✗ Falta LLM_API_KEY en el .env: no se puede correr la prueba E2E.');
    process.exit(1);
  }

  casosFiltrados = FILTRO
    ? CORPUS_PRUEBA_E2E.filter(
        (c) => c.id.toLowerCase().includes(FILTRO) || c.pregunta.toLowerCase().includes(FILTRO),
      )
    : CORPUS_PRUEBA_E2E;

  if (casosFiltrados.length === 0) {
    console.error(`✗ Ningún caso coincide con --filtro=${FILTRO}`);
    process.exit(1);
  }
  console.log(`Casos a correr: ${casosFiltrados.length}${FILTRO ? ` (filtro "${FILTRO}")` : ''}\n`);

  const tareas: Array<() => Promise<CorridaCaso>> = [];
  for (const caso of casosFiltrados) {
    for (let r = 0; r < REPES; r++) {
      tareas.push(() => correrCaso(caso));
    }
  }

  const corridas = await correrConPool(tareas, CONCURRENCIA);

  // Scoreboard por consola.
  for (const c of corridas) {
    const marca = c.resultado.ok ? '✓' : '✗';
    const cola = c.resultado.ok
      ? `${c.pasos} pasos · ${c.ms}ms`
      : c.resultado.detalle || c.error || '';
    console.log(`${marca} ${c.caso.id.padEnd(28)} ${cola}`);
  }

  const total = corridas.length;
  const ok = corridas.filter((c) => c.resultado.ok).length;
  console.log('\n--- Tasa por tipo ---');
  const porTipo = new Map<string, { ok: number; total: number }>();
  for (const c of corridas) {
    const acc = porTipo.get(c.caso.tipo) ?? { ok: 0, total: 0 };
    acc.total += 1;
    if (c.resultado.ok) acc.ok += 1;
    porTipo.set(c.caso.tipo, acc);
  }
  for (const [tipo, acc] of porTipo) {
    console.log(`  ${tipo.padEnd(16)} ${acc.ok}/${acc.total} (${pct(acc.ok, acc.total)}%)`);
  }
  console.log(`\nGLOBAL: ${ok}/${total} (${pct(ok, total)}%)`);

  // --- Latencia ---
  const duraciones = corridas.map((c) => c.ms);
  console.log('\n--- Latencia (ms por caso) ---');
  console.log(
    `  promedio ${promedio(duraciones)} ms · mediana ${mediana(duraciones)} ms · p95 ${percentil(duraciones, 0.95)} ms`,
  );
  console.log('  los 5 más lentos:');
  for (const c of [...corridas].sort((a, b) => b.ms - a.ms).slice(0, 5)) {
    console.log(`    ${c.caso.id.padEnd(28)} ${c.ms}ms (${c.pasos} pasos)`);
  }
  const msPorTipo = new Map<string, number[]>();
  for (const c of corridas) {
    const arr = msPorTipo.get(c.caso.tipo) ?? [];
    arr.push(c.ms);
    msPorTipo.set(c.caso.tipo, arr);
  }
  console.log('  por tipo:');
  for (const [tipo, ms] of msPorTipo) {
    console.log(`    ${tipo.padEnd(16)} promedio ${promedio(ms)} ms · mediana ${mediana(ms)} ms · p95 ${percentil(ms, 0.95)} ms`);
  }

  // --- Disparos por guarda (informativo) ---
  console.log('\n--- Disparos por guarda (informativo) ---');
  for (const [guarda, n] of contarDisparos(corridas)) {
    console.log(`  ${guarda.padEnd(22)} ${n}/${total} (${pct(n, total)}%)`);
  }

  escribirReporte(corridas);
  console.log(`Reporte escrito en ${RUTA_REPORTE}`);

  // Importar el service deja handles abiertos (prisma, timers): cerrar a mano.
  process.exit(ok === total ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ Prueba E2E falló inesperadamente — ${e instanceof Error ? e.stack ?? e.message : e}`);
  process.exit(1);
});
