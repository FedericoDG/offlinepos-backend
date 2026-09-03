'use client';

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { IngresoMensual } from '@/lib/tipos';
import { plata } from '@/lib/formato';

const config = {
  total: { label: 'Cobrado', color: 'var(--chart-1)' },
} satisfies ChartConfig;

function abreviado(valor: number): string {
  if (valor >= 1_000_000) return `${(valor / 1_000_000).toFixed(1)}M`;
  if (valor >= 1_000) return `${Math.round(valor / 1_000)}k`;
  return String(valor);
}

/**
 * Ingreso cobrado por mes. El último mes se pinta más apagado porque todavía
 * está abierto: compararlo de igual a igual con los cerrados haría leer una
 * caída donde solo hay un mes a medio terminar.
 */
export function GraficoIngresos({ datos }: { datos: IngresoMensual[] }) {
  const ultimo = datos.length - 1;
  const hayMovimiento = datos.some((d) => d.total > 0);

  if (!hayMovimiento) {
    return (
      <div className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">Sin pagos registrados</p>
        <p className="text-muted-foreground max-w-xs text-xs">
          Cuando registres el primer cobro, la serie de los últimos doce meses aparece acá.
        </p>
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <BarChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={10} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={abreviado} width={48} />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
          content={
            <ChartTooltipContent
              formatter={(valor, _nombre, item) => (
                <div className="flex w-full flex-col gap-0.5">
                  <span className="cifra text-foreground font-medium">{plata(Number(valor))}</span>
                  <span className="text-muted-foreground">
                    {item?.payload?.cantidad_pagos === 0
                      ? 'sin cobros'
                      : `${item?.payload?.cantidad_pagos} ${item?.payload?.cantidad_pagos === 1 ? 'cobro' : 'cobros'}`}
                  </span>
                </div>
              )}
            />
          }
        />
        <Bar dataKey="total" radius={[6, 6, 0, 0]} maxBarSize={48} isAnimationActive={false}>
          {datos.map((dato, indice) => (
            <Cell key={dato.periodo} fill={indice === ultimo ? 'var(--chart-3)' : 'var(--chart-1)'} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
