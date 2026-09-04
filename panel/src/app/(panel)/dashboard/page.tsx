import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { EstadoDeSuscripcion } from '@/components/panel/estado-suscripcion';
import { Kpi } from '@/components/dashboard/kpi';
import { GraficoIngresos } from '@/components/dashboard/grafico-ingresos';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha, plata, porcentaje, vencimiento } from '@/lib/formato';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function PaginaDashboard() {
  const [resumen, ingresos, porPlan, vencimientos] = await Promise.all([
    consultas.resumen(),
    consultas.ingresosMensuales(12),
    consultas.ingresosPorPlan(12),
    consultas.proximosVencimientos(45),
  ]);

  const totalPorPlan = porPlan.reduce((suma, fila) => suma + fila.total, 0);
  const criticos = vencimientos.filter((v) => v.vencida).length;

  return (
    <>
      <EncabezadoPagina
        titulo="Cómo viene el mes"
        descripcion="Lo cobrado, lo que está por vencer y lo que ya se pasó de fecha."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          etiqueta="Cobrado este mes"
          valor={plata(resumen.ingreso_mes)}
          tono="acento"
          detalle={
            <span>
              {resumen.pagos_mes} {resumen.pagos_mes === 1 ? 'cobro' : 'cobros'} &middot;{' '}
              <span
                className={
                  resumen.variacion_mensual && resumen.variacion_mensual < 0 ? 'text-destructive' : 'text-[var(--success)]'
                }
              >
                {porcentaje(resumen.variacion_mensual)}
              </span>{' '}
              vs. mes anterior
            </span>
          }
        />
        <Kpi
          etiqueta="Ingreso recurrente (MRR)"
          valor={plata(resumen.mrr)}
          detalle={`${resumen.suscripciones.activas} suscripciones al día`}
        />
        <Kpi
          etiqueta="Vencen en 30 días"
          valor={resumen.por_vencer_30_dias}
          tono={resumen.por_vencer_30_dias > 0 ? 'alerta' : 'neutro'}
          detalle={`${resumen.suscripciones.en_gracia} en período de gracia (${resumen.dias_gracia} días)`}
        />
        <Kpi
          etiqueta="Vencidas"
          valor={resumen.suscripciones.vencidas}
          tono={resumen.suscripciones.vencidas > 0 ? 'critico' : 'neutro'}
          detalle={`de ${resumen.suscripciones.total} suscripciones · ${resumen.comercios} comercios`}
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.9fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Ingreso mensual</CardTitle>
            <CardDescription>Últimos doce meses, por fecha de cobro.</CardDescription>
          </CardHeader>
          <CardContent>
            <GraficoIngresos datos={ingresos} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reparto por plan</CardTitle>
            <CardDescription>Del cobrado en el mismo período.</CardDescription>
          </CardHeader>
          <CardContent>
            {porPlan.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">Todavía no hay cobros para repartir.</p>
            ) : (
              <ul className="space-y-5">
                {porPlan.map((fila) => {
                  const proporcion = totalPorPlan === 0 ? 0 : Math.round((fila.total / totalPorPlan) * 100);
                  return (
                    <li key={fila.plan_id} className="space-y-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium">{fila.nombre}</span>
                        <span className="cifra text-sm tabular-nums">{plata(fila.total)}</span>
                      </div>
                      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                        <div className="bg-primary h-full rounded-full" style={{ width: `${proporcion}%` }} />
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {proporcion}% &middot; {fila.cantidad} {fila.cantidad === 1 ? 'pago' : 'pagos'}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        <Card className="gap-0">
          <CardHeader className="border-b">
            <CardTitle>Próximos vencimientos</CardTitle>
            <CardDescription>
              {criticos > 0
                ? `${criticos} ${criticos === 1 ? 'suscripción ya venció' : 'suscripciones ya vencieron'}. Los próximos 45 días, de más urgente a menos.`
                : 'Los próximos 45 días, de más urgente a menos.'}
            </CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href="/suscripciones">
                  Ver todas <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Comercio</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead className="pr-6">Último pago</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vencimientos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground h-28 text-center">
                      No hay vencimientos en los próximos 45 días.
                    </TableCell>
                  </TableRow>
                ) : (
                  vencimientos.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="pl-6 font-medium">{item.comercio.nombre}</TableCell>
                      <TableCell className="text-muted-foreground">{item.plan?.nombre ?? '—'}</TableCell>
                      <TableCell>
                        <span className="cifra tabular-nums">{fecha(item.vence_en)}</span>
                        <span
                          className={cn(
                            'ml-2 text-xs',
                            item.vencida
                              ? 'text-destructive'
                              : item.dias_restantes <= 7
                                ? 'text-[var(--warning)]'
                                : 'text-muted-foreground'
                          )}
                        >
                          {vencimiento(item.dias_restantes)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <EstadoDeSuscripcion
                          estado={item.vencida ? (item.en_gracia ? 'EN_GRACIA' : 'VENCIDA') : 'ACTIVA'}
                        />
                      </TableCell>
                      <TableCell className="cifra text-right tabular-nums">{plata(item.precio_pactado)}</TableCell>
                      <TableCell className="cifra text-muted-foreground pr-6 tabular-nums">
                        {item.ultimo_pago ? fecha(item.ultimo_pago.pagado_en) : 'nunca'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
