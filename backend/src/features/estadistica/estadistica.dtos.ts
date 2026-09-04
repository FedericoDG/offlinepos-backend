import { z } from 'zod';

export const RangoMesesDTO = z.object({
  meses: z.coerce.number().int().min(1).max(36).default(12),
});

export type RangoMesesDTO = z.infer<typeof RangoMesesDTO>;

export const RangoDiasDTO = z.object({
  dias: z.coerce.number().int().min(1).max(365).default(30),
});

export type RangoDiasDTO = z.infer<typeof RangoDiasDTO>;

export interface IngresoMensualDTO {
  /** Clave ordenable: 2026-08 */
  periodo: string;
  /** Etiqueta corta para el eje del grafico: ago 26 */
  etiqueta: string;
  total: number;
  cantidad_pagos: number;
}
