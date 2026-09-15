/**
 * Precios del LLM en USD por millón de tokens — ÚNICA fuente de verdad para
 * contabilidad de costos (scripts, batería, futuro endpoint del panel).
 *
 * Modelo: qwen3.7-flash (env LLM_MODEL), tier "Input <= 32k" (nuestros prompts
 * rondan 7-40k tokens).
 * Fuente: https://www.qwencloud.com/models/qwen3.7-flash#features
 * Verificado: 2026-09-14. Si la tarifa cambia, actualizar acá (1 línea).
 *
 * - entrada: prompt NO cacheado ($0.03/1M).
 * - entradaCacheada: Input (Implicit Cache) ($0.006/1M). El proveedor aplica
 *   caché implícito solo, sin configurar nada; `cached_tokens` del usage cae
 *   en esta tarifa.
 * - salida: completion ($0.13/1M).
 */
export const PRECIOS_USD_POR_1M = {
  modelo: 'qwen3.7-flash',
  verificado: '2026-09-14',
  fuente: 'https://www.qwencloud.com/models/qwen3.7-flash#features',
  entrada: 0.03,
  entradaCacheada: 0.006,
  salida: 0.13,
} as const;

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

/** Formato corto para reportes: 0.00019 → "$0.00019". */
export function fmtUSD(valor: number): string {
  return `$${valor.toFixed(5)}`;
}
