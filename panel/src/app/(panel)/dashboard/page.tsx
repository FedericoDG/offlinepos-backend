import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Kpi } from '@/components/dashboard/kpi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha } from '@/lib/formato';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function PaginaDashboard() {
  const [comercios, planes, consumo] = await Promise.all([
    consultas.comercios(),
    consultas.planes(true),
    consultas.chatConsumo().catch(() => ({
      resumen: { total_mensajes: 0, total_tokens: 0, total_costo_usd: 0, comercios_activos: 0 },
      detalle: [],
    })),
  ]);

  const porId = new Map(planes.map((plan) => [plan.id, plan]));
  const planesEnUso = new Set(comercios.map((c) => c.plan_id).filter((id): id is string => Boolean(id)));
  const servidoresActivos = comercios.reduce(
    (suma, c) => suma + c.licencias.filter((l) => l.estado === 'activa' && l.rol === 'SERVIDOR').length,
    0
  );

  return (
    <>
      <EncabezadoPagina
        titulo="Cómo están los comercios"
        descripcion="Qué comercios hay, qué plan usa cada uno y cuánto consume el chat IA. Claves en detalle en su sección."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          etiqueta="Comercios"
          valor={comercios.length}
          tono="acento"
          detalle={`${planesEnUso.size} ${planesEnUso.size === 1 ? 'plan distinto en uso' : 'planes distintos en uso'}`}
        />
        <Kpi
          etiqueta="Licencias servidor activas"
          valor={servidoresActivos}
          detalle="las cajas activas de cada comercio"
        />
        <Kpi
          etiqueta="Planes activos"
          valor={planes.length}
          detalle="los que se pueden asignar en el alta de un comercio"
        />
        <Kpi
          etiqueta="Consumo chat del mes"
          valor={consumo.resumen.total_mensajes}
          detalle={
            consumo.resumen.comercios_activos > 0
              ? `${consumo.resumen.comercios_activos} ${
                  consumo.resumen.comercios_activos === 1 ? 'comercio lo usó' : 'comercios lo usaron'
                } · ${consumo.resumen.total_tokens.toLocaleString('es-AR')} tokens`
              : 'sin uso este mes'
          }
        />
      </section>

      <section className="mt-4">
        <Card className="gap-0">
          <CardHeader className="border-b">
            <CardTitle>Comercios y estado de su plan</CardTitle>
            <CardDescription>
              El plan es el asignado al comercio, no una suscripción. El cupo de claves sale de lo que declara ese plan.
            </CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href="/comercios">
                  Ver todos <ArrowRight />
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
                  <TableHead>Licencias servidor</TableHead>
                  <TableHead>Alta</TableHead>
                  <TableHead className="pr-6 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comercios.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground h-28 text-center">
                      Todavía no hay comercios cargados.
                    </TableCell>
                  </TableRow>
                ) : (
                  comercios.map((comercio) => {
                    const plan = comercio.plan_id ? porId.get(comercio.plan_id) : undefined;
                    const activas = comercio.licencias.filter((l) => l.estado === 'activa');
                    const servidores = activas.filter((l) => l.rol === 'SERVIDOR').length;
                    const cupoServidores = plan?.max_servidores ?? '—';
                    const excedeServidores = typeof cupoServidores === 'number' && servidores > cupoServidores;

                    return (
                      <TableRow key={comercio.id}>
                        <TableCell className="pl-6 font-medium">{comercio.nombre}</TableCell>
                        <TableCell>
                          {plan ? (
                            <Badge variant="info">{plan.nombre}</Badge>
                          ) : (
                            <span className="text-[var(--warning)] text-sm">sin plan asignado</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="cifra tabular-nums">
                            {servidores} / {cupoServidores}
                          </span>
                          {excedeServidores && (
                            <Badge variant="danger" className="ml-2">
                              sobre cupo
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="cifra text-muted-foreground tabular-nums">
                          {fecha(comercio.createdAt)}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/licencias?q=${encodeURIComponent(comercio.nombre)}`}>Ver claves</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
