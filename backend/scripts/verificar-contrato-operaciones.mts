/**
 * Verificador del CONTRATO de las operaciones tipadas de Binny.
 *
 * El smoke del desktop escribe `/tmp/opencode/ops-contrato.json` con la forma
 * (claves) REAL que devuelve cada operación (`consultar_ventas`,
 * `consultar_compras`, `consultar_gastos`, `consultar_productos`,
 * `consultar_movimientos_stock`, `consultar_presupuestos`, `consultar_clientes`,
 * `consultar_proveedores`, `consultar_turnos_caja`) tanto en modo lista como en
 * modo detalle.
 *
 * Este script lee ese artefacto y lo compara con las claves que usan los
 * FIXTURES del ejecutor E2E (`scripts/prueba-binny-e2e.mts`) y con las
 * operaciones que espera el corpus (`src/features/chat/chat.prueba.e2e.ts`).
 *
 * Reglas:
 *   - Si el artefacto NO existe → aviso claro (hay que correr el smoke del
 *     desktop) y exit 0. No es un fallo.
 *   - Si existe y las claves DIFIEREN → exit 1 listando las diferencias.
 *   - Si existe y coincide → exit 0.
 *
 * Forma real observada del artefacto (se tolera también una variante plana):
 *
 *   {
 *     "generado_en": "...",
 *     "operaciones": {
 *       "consultar_ventas": {
 *         "lista":   { "operacion": "string", "periodo_resuelto": {...},
 *                      "filtros": "object", "total": "number",
 *                      "filas": ["id", "fecha", ...] },
 *         "detalle": { "operacion": "string", "detalle": ["id", "fecha", ...] }
 *       }, ...
 *     }
 *   }
 *
 *   Las claves de fila/detalle pueden venir como array de strings (nombres) o
 *   como array de muestras (objetos); se aceptan las dos.
 *
 * Uso:
 *   npx tsx scripts/verificar-contrato-operaciones.mts
 */
import fs from 'node:fs';

import { CORPUS_PRUEBA_E2E } from '../src/features/chat/chat.prueba.e2e';

const RUTA_ARTEFACTO = '/tmp/opencode/ops-contrato.json';

// ============================================================================
// Claves que usan los FIXTURES del ejecutor E2E.
// Espejo de las interfaces y de `salidaLista`/`salidaListaOrdenada` de
// `scripts/prueba-binny-e2e.mts`. Si los fixtures cambian, actualizar acá.
//
// Los metadatos del banco de pruebas (`simulado`, `limitacion`) se EXCLUYEN a
// propósito: no son contrato del producto, solo marcas del simulador.
// ============================================================================

interface ClavesOperacion {
  /** Claves del envoltorio de la respuesta de lista. */
  lista?: string[];
  /** Claves de una fila de `filas`. */
  fila?: string[];
  /** Claves del envoltorio de la respuesta de detalle. */
  detalle?: string[];
  /** Claves del contenido de `detalle`. */
  detalleContenido?: string[];
}

const WRAPPER_LISTA = ['operacion', 'periodo_resuelto', 'filtros', 'total', 'filas'];
const WRAPPER_DETALLE = ['operacion', 'detalle'];

const CLAVES_FIXTURES: Record<string, ClavesOperacion> = {
  consultar_ventas: {
    lista: WRAPPER_LISTA,
    fila: ['id', 'fecha', 'total', 'cliente', 'usuario', 'medios_pago', 'cantidad_items'],
    detalle: WRAPPER_DETALLE,
    detalleContenido: ['id', 'fecha', 'total', 'estado', 'cliente', 'usuario', 'nota', 'items', 'pagos'],
  },
  consultar_compras: {
    lista: WRAPPER_LISTA,
    fila: ['id', 'fecha', 'proveedor', 'total', 'cantidad_items'],
    detalle: WRAPPER_DETALLE,
    detalleContenido: ['id', 'fecha', 'proveedor', 'total', 'anulada', 'numero_comprobante', 'nota', 'items'],
  },
  consultar_gastos: {
    lista: WRAPPER_LISTA,
    fila: ['id', 'fecha', 'concepto', 'monto', 'categoria', 'metodo_pago', 'comprobante'],
    detalle: WRAPPER_DETALLE,
    detalleContenido: ['id', 'fecha', 'concepto', 'monto', 'categoria', 'metodo_pago', 'comprobante', 'proveedor', 'nota', 'anulado', 'anulado_motivo', 'atado_a_turno', 'turno_caja_id'],
  },
  consultar_productos: {
    lista: WRAPPER_LISTA,
    fila: ['id', 'nombre', 'codigo_interno', 'categorias', 'marca', 'cantidad', 'stock_minimo', 'unidad', 'precio_costo', 'precio_venta', 'activo'],
    detalle: WRAPPER_DETALLE,
    detalleContenido: ['id', 'nombre', 'codigo_interno', 'codigo_barras', 'categorias', 'marca', 'cantidad', 'stock_minimo', 'unidad', 'precio_costo', 'precio_venta', 'activo', 'permitir_sin_stock', 'lote', 'fecha_vencimiento', 'presentaciones'],
  },
  consultar_movimientos_stock: {
    lista: WRAPPER_LISTA,
    fila: ['id', 'fecha', 'producto', 'tipo', 'cantidad', 'nota', 'stock_resultante'],
    detalle: WRAPPER_DETALLE,
    detalleContenido: ['id', 'fecha', 'producto_id', 'producto', 'codigo_interno', 'tipo', 'cantidad', 'stock_resultante', 'nota', 'usuario'],
  },
  consultar_presupuestos: {
    lista: WRAPPER_LISTA,
    fila: ['id', 'fecha', 'cliente', 'total', 'estado', 'vencimiento', 'validez_dias', 'cantidad_items'],
    detalle: WRAPPER_DETALLE,
    detalleContenido: ['id', 'numero', 'fecha', 'vencimiento', 'validez_dias', 'estado', 'cliente', 'usuario', 'total', 'descuento', 'recargo', 'recargo_concepto', 'nota', 'convertido', 'venta_id', 'items'],
  },
  consultar_clientes: {
    lista: WRAPPER_LISTA,
    fila: ['id', 'nombre', 'documento', 'telefono', 'saldo_actual', 'limite_credito', 'ultimo_movimiento', 'activo'],
    detalle: WRAPPER_DETALLE,
    detalleContenido: ['id', 'nombre', 'razon_social', 'documento', 'telefono', 'celular', 'email', 'direccion', 'localidad', 'condicion_iva', 'limite_credito', 'permite_credito', 'saldo_actual', 'nota', 'activo', 'movimientos'],
  },
  consultar_proveedores: {
    lista: WRAPPER_LISTA,
    fila: ['id', 'nombre', 'telefono', 'email', 'direccion', 'activo', 'cantidad_compras'],
    detalle: WRAPPER_DETALLE,
    detalleContenido: ['id', 'nombre', 'telefono', 'email', 'direccion', 'nota', 'activo', 'compras'],
  },
  consultar_turnos_caja: {
    lista: WRAPPER_LISTA,
    fila: ['id', 'apertura', 'cierre', 'usuario', 'monto_inicial', 'monto_contado', 'diferencia', 'estado', 'cantidad_ventas'],
    detalle: WRAPPER_DETALLE,
    detalleContenido: ['id', 'apertura', 'cierre', 'usuario', 'monto_inicial', 'monto_contado', 'efectivo_esperado', 'diferencia', 'estado', 'cantidad_ventas', 'observaciones_cierre', 'retiros', 'totales_por_medio'],
  },
};

const OPERACIONES = Object.keys(CLAVES_FIXTURES);
const CATEGORIAS: Array<keyof ClavesOperacion> = ['lista', 'fila', 'detalle', 'detalleContenido'];

// ============================================================================
// Lectura del artefacto (tolera arrays de nombres o de muestras)
// ============================================================================

function clavesDe(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.filter((x): x is string => typeof x === 'string');
  if (valor && typeof valor === 'object') return Object.keys(valor as Record<string, unknown>);
  return [];
}

/** Claves de una fila: array de strings (nombres) o array de muestras (objetos). */
function clavesFilas(valor: unknown): string[] | undefined {
  if (!Array.isArray(valor) || valor.length === 0) return undefined;
  if (typeof valor[0] === 'string') return valor as string[];
  return clavesDe(valor[0]);
}

function leerClavesOperacion(valor: unknown): ClavesOperacion {
  if (!valor || typeof valor !== 'object') return {};
  const obj = valor as Record<string, unknown>;

  let lista: string[] | undefined;
  let fila: string[] | undefined;
  const listaVal = obj.lista;
  if (Array.isArray(listaVal)) {
    lista = clavesDe(listaVal);
  } else if (listaVal && typeof listaVal === 'object') {
    lista = Object.keys(listaVal as Record<string, unknown>);
    fila = clavesFilas((listaVal as Record<string, unknown>).filas);
  }

  let detalle: string[] | undefined;
  let detalleContenido: string[] | undefined;
  const detalleVal = obj.detalle;
  if (Array.isArray(detalleVal)) {
    detalleContenido = clavesDe(detalleVal);
  } else if (detalleVal && typeof detalleVal === 'object') {
    const d = detalleVal as Record<string, unknown>;
    detalle = Object.keys(d);
    if ('detalle' in d) detalleContenido = clavesDe(d.detalle);
  }

  return { lista, fila, detalle, detalleContenido };
}

// ============================================================================
// Comparación
// ============================================================================

function diferencia(a: string[], b: string[]): { soloA: string[]; soloB: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    soloA: a.filter((x) => !setB.has(x)),
    soloB: b.filter((x) => !setA.has(x)),
  };
}

function operacionesDelCorpus(): string[] {
  const usadas = new Set<string>();
  for (const caso of CORPUS_PRUEBA_E2E) {
    for (const h of caso.usaHerramienta ?? []) {
      if (OPERACIONES.includes(h)) usadas.add(h);
    }
  }
  return [...usadas].sort();
}

function main(): void {
  console.log('=== Verificación del contrato de operaciones (fixtures E2E ↔ producto) ===');
  console.log(`Artefacto del desktop: ${RUTA_ARTEFACTO}`);

  if (!fs.existsSync(RUTA_ARTEFACTO)) {
    console.log('');
    console.log('⚠ No existe el artefacto del contrato de operaciones.');
    console.log('  Hay que correr el SMOKE del desktop, que lo escribe en:');
    console.log(`    ${RUTA_ARTEFACTO}`);
    console.log('  Sin ese artefacto no se puede comparar; no se considera un fallo.');
    process.exit(0);
  }

  let datos: unknown;
  try {
    datos = JSON.parse(fs.readFileSync(RUTA_ARTEFACTO, 'utf8'));
  } catch (e) {
    console.error(`✗ El artefacto existe pero no es JSON válido: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    console.error('✗ El artefacto debe ser un objeto con una entrada por operación.');
    process.exit(1);
  }

  // Forma real: { generado_en, operaciones: { ... } }. Se tolera una forma plana.
  const raiz = datos as Record<string, unknown>;
  const artefacto =
    raiz.operaciones && typeof raiz.operaciones === 'object' && !Array.isArray(raiz.operaciones)
      ? (raiz.operaciones as Record<string, unknown>)
      : raiz;

  const problemas: string[] = [];
  let comparaciones = 0;

  for (const operacion of OPERACIONES) {
    const reales = leerClavesOperacion(artefacto[operacion]);
    const fixtures = CLAVES_FIXTURES[operacion]!;
    const tieneAlgo = CATEGORIAS.some((c) => (reales[c]?.length ?? 0) > 0);

    if (!tieneAlgo) {
      problemas.push(`• ${operacion}: el artefacto no trae claves (¿el smoke no cubrió la operación?)`);
      continue;
    }

    for (const categoria of CATEGORIAS) {
      const esperadas = fixtures[categoria];
      if (!esperadas) continue;
      const obtenidas = reales[categoria];
      if (!obtenidas) {
        problemas.push(
          `• ${operacion} · ${categoria}: el artefacto no trae esta sección (fixtures: ${esperadas.join(', ')})`,
        );
        continue;
      }
      comparaciones += 1;
      const { soloA, soloB } = diferencia(obtenidas, esperadas);
      // `soloA` = el PRODUCTO devuelve claves que el fixture NO tiene (falta en el banco).
      // `soloB` = el fixture tiene claves que el producto NO devuelve (clave fantasma).
      if (soloA.length > 0) {
        problemas.push(
          `• ${operacion} · ${categoria}: el producto devuelve claves que el fixture NO tiene → ${soloA.join(', ')}`,
        );
      }
      if (soloB.length > 0) {
        problemas.push(
          `• ${operacion} · ${categoria}: el fixture tiene claves que el producto NO devuelve → ${soloB.join(', ')}`,
        );
      }
    }
  }

  // El corpus usa operaciones concretas: todas deben estar en el artefacto.
  const delCorpus = operacionesDelCorpus();
  for (const operacion of delCorpus) {
    const reales = leerClavesOperacion(artefacto[operacion]);
    const tieneAlgo = CATEGORIAS.some((c) => (reales[c]?.length ?? 0) > 0);
    if (!tieneAlgo && !problemas.some((p) => p.includes(`${operacion}:`))) {
      problemas.push(`• ${operacion}: el corpus la usa pero el artefacto no la cubre`);
    }
  }

  console.log('');
  console.log(`Operaciones del corpus: ${delCorpus.join(', ') || '(ninguna)'}`);

  if (problemas.length === 0) {
    console.log(`✓ Contrato coherente: 0 diferencias sobre ${OPERACIONES.length} operaciones (${comparaciones} secciones comparadas).`);
    process.exit(0);
  }

  console.log(`✗ Diferencias entre el producto y los fixtures (${problemas.length}):`);
  for (const p of problemas) console.log(`  ${p}`);
  process.exit(1);
}

main();
