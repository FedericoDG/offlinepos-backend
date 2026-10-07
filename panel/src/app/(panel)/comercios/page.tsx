import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Mail, Phone, Store } from 'lucide-react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { BadgeDeuda, BadgePlan } from '@/components/panel/estado-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha } from '@/lib/formato';
import { AjustarCupoBinny, EditarComercio, EliminarComercio } from './formularios';

export const metadata: Metadata = { title: 'Comercios' };
export const dynamic = 'force-dynamic';

export default async function PaginaComercios() {
  const [comercios, planes] = await Promise.all([consultas.comercios(), consultas.planes()]);

  // El listado ya trae el plan anidado liviano; el catálogo se sigue usando
  // para el cupo de claves (max_servidores), que el resumen no incluye.
  const porId = new Map(planes.map((plan) => [plan.id, plan]));

  return (
    <>
      <EncabezadoPagina
        titulo="Comercios"
        descripcion="Quiénes usan el POS, qué plan tienen, cuántas claves tienen asignadas y cómo viene su deuda estimada. El cupo sale del plan: mientras quepa, el comercio suma claves."
        accion={
          <Button asChild>
            <Link href="/comercios/alta">
              <Store /> Nuevo comercio
            </Link>
          </Button>
        }
      />

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Comercio</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Claves</TableHead>
                <TableHead>Deuda</TableHead>
                <TableHead>Alta</TableHead>
                <TableHead className="pr-6 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comercios.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="h-40">
                    <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 text-center">
                      <Store className="size-8 opacity-40" />
                      <p className="text-sm font-medium">Todavía no hay comercios cargados.</p>
                      <p className="text-xs">
                        Empezá por{' '}
                        <Link href="/comercios/alta" className="text-foreground underline-offset-2 hover:underline">
                          dar de alta el primero
                        </Link>
                        : elegís plan y claves en el mismo paso.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                comercios.map((comercio) => {
                  const plan = comercio.plan_id ? porId.get(comercio.plan_id) : undefined;
                  // El nombre puede venir anidado en el listado; si no, se cruza con el catálogo.
                  const nombrePlan = comercio.plan?.nombre ?? plan?.nombre;
                  const activas = comercio.licencias.filter((l) => l.estado === 'activa');
                  const servidores = activas.filter((l) => l.rol === 'SERVIDOR').length;
                  const clientes = activas.filter((l) => l.rol === 'CLIENTE').length;
                  const periodos = comercio.deuda_periodos ?? 0;

                  return (
                    <TableRow key={comercio.id}>
                      <TableCell className="pl-6">
                        <Link
                          href={`/comercios/${comercio.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {comercio.nombre}
                        </Link>
                        <div className="text-muted-foreground mt-0.5 flex flex-col gap-0.5 text-xs">
                          {comercio.telefono ? (
                            <span className="flex items-center gap-1.5">
                              <Phone className="size-3 shrink-0" />
                              <span className="max-w-[220px] truncate">{comercio.telefono}</span>
                            </span>
                          ) : null}
                          {comercio.email ? (
                            <span className="flex items-center gap-1.5">
                              <Mail className="size-3 shrink-0" />
                              <span className="max-w-[220px] truncate">{comercio.email}</span>
                            </span>
                          ) : null}
                          {!comercio.telefono && !comercio.email ? <span>sin contacto</span> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <BadgePlan nombre={nombrePlan} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="cifra text-sm tabular-nums">
                            {servidores}/{plan?.max_servidores ?? '—'} servidor
                          </span>
                          <Badge variant="secondary">{clientes} cliente</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <BadgeDeuda alDia={periodos === 0} periodos={periodos} />
                      </TableCell>
                      <TableCell className="cifra text-muted-foreground tabular-nums">
                        {fecha(comercio.createdAt)}
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex flex-wrap justify-end gap-2">
                          <EditarComercio comercio={comercio} />
                          <AjustarCupoBinny comercio={comercio} />
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/comercios/${comercio.id}`}>
                              Ver detalle <ArrowRight />
                            </Link>
                          </Button>
                          <EliminarComercio comercio={comercio} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-4 max-w-2xl text-xs leading-relaxed">
        El cupo de claves lo declara el plan del comercio. Si el comercio cambió de PC, liberá la instalación desde{' '}
        <Link href="/licencias" className="text-foreground underline-offset-2 hover:underline">
          Claves
        </Link>
        : el cupo vuelve sin cambiarle la clave. La deuda es una <span className="text-foreground">estimación</span> a
        partir de los períodos cubiertos por pagos.
      </p>
    </>
  );
}
