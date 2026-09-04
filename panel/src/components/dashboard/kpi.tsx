import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Número de cabecera. Card de shadcn con la cifra en tabular. */
export function Kpi({
  etiqueta,
  valor,
  detalle,
  tono = 'neutro',
  className,
}: {
  etiqueta: string;
  valor: ReactNode;
  detalle?: ReactNode;
  tono?: 'neutro' | 'acento' | 'alerta' | 'critico';
  className?: string;
}) {
  const color = {
    neutro: 'text-foreground',
    acento: 'text-primary',
    alerta: 'text-[var(--warning)]',
    critico: 'text-destructive',
  }[tono];

  return (
    <Card className={cn('gap-3 py-5', className)}>
      <CardHeader className="px-5">
        <CardDescription>{etiqueta}</CardDescription>
        <CardTitle className={cn('cifra text-3xl font-semibold tabular-nums', color)}>{valor}</CardTitle>
      </CardHeader>
      {detalle && (
        <CardContent className="text-muted-foreground px-5 text-xs">{detalle}</CardContent>
      )}
    </Card>
  );
}
