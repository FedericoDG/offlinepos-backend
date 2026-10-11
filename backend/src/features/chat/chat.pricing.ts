/**
 * Precios del LLM en USD por millón de tokens — ÚNICA fuente de verdad para
 * contabilidad de costos (scripts, batería, futuro endpoint del panel).
 *
 * Modelo: qwen3.8-flash (env LLM_MODEL). Precio plano (sin tier por contexto).
 * Fuente: https://www.qwencloud.com/models/qwen3.8-flash#pricing
 * Verificado: 2026-10-11. Si la tarifa cambia, actualizar acá (1 línea).
 *
 * - entrada: prompt NO cacheado ($0.15/1M).
 * - entradaCacheada: Input (Implicit Cache) ($0.016/1M). El proveedor aplica
 *   caché implícito solo, sin configurar nada; `cached_tokens` del usage cae
 *   en esta tarifa.
 * - salida: completion ($0.47/1M).
 *
 * Referencia del modelo anterior (qwen3.7-flash, tier "Input <= 32k"):
 * entrada $0.03/1M · caché $0.006/1M · salida $0.13/1M — si se revierte el
 * LLM_MODEL, hay que restaurar estos valores.
 */
export const PRECIOS_USD_POR_1M = {
  modelo: 'qwen3.8-flash',
  verificado: '2026-10-11',
  fuente: 'https://www.qwencloud.com/models/qwen3.8-flash#pricing',
  entrada: 0.15,
  entradaCacheada: 0.016,
  salida: 0.47,
} as const;

/** Tarifas de un modelo: USD por millón de tokens. */
export interface PrecioModelo {
  entrada: number;
  entradaCacheada: number;
  salida: number;
}

/**
 * Tarifas por modelo (USD por 1M). El historico se cobra con el precio del
 * modelo con el que se genero, no con el vigente: `ChatConsumo.modelo` guarda
 * cual fue. El modelo vigente reusa los valores de PRECIOS_USD_POR_1M para que
 * no puedan divergir; el anterior queda fijo (no se vuelve a usar).
 */
export const PRECIOS_POR_MODELO: Record<string, PrecioModelo> = {
  // Modelo anterior (tier "Input <= 32k"): historico previo al cambio.
  'qwen3.7-flash': { entrada: 0.03, entradaCacheada: 0.006, salida: 0.13 },
  // Modelo vigente: misma tarifa que PRECIOS_USD_POR_1M (fuente unica).
  'qwen3.8-flash': {
    entrada: PRECIOS_USD_POR_1M.entrada,
    entradaCacheada: PRECIOS_USD_POR_1M.entradaCacheada,
    salida: PRECIOS_USD_POR_1M.salida,
  },
};

/**
 * Costo en USD de una llamada/ciclo dados sus tokens.
 * `cachedTokens` es subconjunto de `promptTokens` (ya incluido): se descuenta
 * de la tarifa plena y se cobra a tarifa de caché.
 */
export function costoUSD(promptTokens: number, completionTokens: number, cachedTokens = 0): number {
  const noCacheados = Math.max(0, promptTokens - cachedTokens);
  return (
    (noCacheados * PRECIOS_USD_POR_1M.entrada +
      cachedTokens * PRECIOS_USD_POR_1M.entradaCacheada +
      completionTokens * PRECIOS_USD_POR_1M.salida) /
    1_000_000
  );
}

/**
 * Costo en USD resolviendo la tarifa POR MODELO. Si `modelo` no esta en el
 * mapa (desconocido, vacio o un modelo futuro sin tarifa cargada) cae al modelo
 * vigente (PRECIOS_USD_POR_1M): preferimos un numero aproximado a romper el
 * reporte. Misma formula que `costoUSD`.
 */
export function costoUSDDeModelo(
  modelo: string,
  promptTokens: number,
  completionTokens: number,
  cachedTokens = 0,
): number {
  const precios = PRECIOS_POR_MODELO[modelo] ?? PRECIOS_USD_POR_1M;
  const noCacheados = Math.max(0, promptTokens - cachedTokens);
  return (
    (noCacheados * precios.entrada +
      cachedTokens * precios.entradaCacheada +
      completionTokens * precios.salida) /
    1_000_000
  );
}

/** Formato corto para reportes: 0.00019 → "$0.00019". */
export function fmtUSD(valor: number): string {
  return `$${valor.toFixed(5)}`;
}
