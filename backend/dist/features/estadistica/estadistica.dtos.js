import { z } from 'zod';
export const RangoMesesDTO = z.object({
    meses: z.coerce.number().int().min(1).max(36).default(12),
});
export const RangoDiasDTO = z.object({
    dias: z.coerce.number().int().min(1).max(365).default(30),
});
