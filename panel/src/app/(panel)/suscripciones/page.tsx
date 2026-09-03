import type { Metadata } from 'next';
import Link from 'next/link';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { EstadoDeSuscripcion } from '@/components/panel/estado-suscripcion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha, plata, vencimiento } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { CambiarEstado, EditarSuscripcion, NuevaSuscripcion, RenovarSuscripcion } from './formularios';

export const metadata: Metadata = { title: 'Suscripciones' };
export const dynamic = 'force-dynamic';

const FILTROS = [
  { clave: '', texto: 'Todas' },
  { clave: 'ACTIVA', texto: 'Activas' },
  { clave: 'EN_GRACIA', texto: 'En gracia' },
  { clave: 'VENCIDA', texto: 'Vencidas' },
  { clave: 'CANCELADA', texto: 'Canceladas' },
];

export default async function PaginaSuscripciones({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;

  const [todas, comercios, planes] = await Promise.all([
    consultas.suscripciones(),
    consultas.comercios(),
    consultas.planes(),
  ]);

  // El filtro corre sobre el estado efectivo (el que se ve en la tabla), no
  // sobre el guardado: si no, "Vencidas" dejaría afuera a las que vencieron
  // ayer y siguen marcadas como activas en la base.
  const suscripciones = estado ? todas.filter((s) => s.estado_efectivo === estado) : todas;

  // Solo tiene sentido ofrecer un comercio que todavía no tiene contrato vivo.
  const conContrato = new Set(todas.filter((s) => s.estado !== 'CANCELADA').map((s) => s.comercio.id));
  const disponibles = comercios.filter((c) => !conContrato.has(c.id));

  return (
    <>
      <EncabezadoPagina
        titulo="Suscripciones"
        descripcion="El contrato comercial de cada comercio: qué plan tiene, cuánto paga y hasta cuándo está al día."
        accion={<NuevaSuscripcion comercios={disponibles} planes={planes} />}
      />

      <nav className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((filtro) => {
          const activo = (estado ?? '') === filtro.clave;
          return (
            <Button
              key={filtro.texto}
              asChild
              variant={activo ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(!activo && 'text-muted-foreground')}
            >
              <Link href={filtro.clave ? `/suscripciones?estado=${filtro.clave}` : '/suscripciones'}>
                {filtro.texto}
              </Link>
            </Button>
          );
        })}
      </nav>

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Comercio</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Último pago</TableHead>
                <TableHead className="pr-6 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suscripciones.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground h-28 text-center">
                    No hay suscripciones con este filtro.
                  </TableCell>
                </TableRow>
              ) : (
                suscripciones.map((suscripcion) => {
                  const ultimo = suscripcion.pagos[0];

                  return (
                    <TableRow key={suscripcion.id}>
                      <TableCell className="pl-6 font-medium">
                        {suscripcion.comercio.nombre}
                        {suscripcion.nota && (
                          <p className="text-muted-foreground mt-0.5 max-w-xs text-xs font-normal">
                            {suscripcion.nota}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-muted-foreground text-sm">{suscripcion.plan?.nombre ?? '—'}</span>
                          <Badge variant="secondary">{suscripcion.ciclo}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="cifra text-right tabular-nums">
                        {plata(suscripcion.precio_pactado)}
                      </TableCell>
                      <TableCell>
                        <span className="cifra tabular-nums">{fecha(suscripcion.vence_en)}</span>
                        <div
                          className={cn(
                            'mt-0.5 text-xs',
                            suscripcion.estado_efectivo === 'VENCIDA'
                              ? 'text-destructive'
                              : suscripcion.dias_restantes <= 7
                                ? 'text-[var(--warning)]'
                                : 'text-muted-foreground'
                          )}
                        >
                          {suscripcion.estado === 'CANCELADA' ? 'dada de baja' : vencimiento(suscripcion.dias_restantes)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <EstadoDeSuscripcion estado={suscripcion.estado_efectivo} />
                      </TableCell>
                      <TableCell>
                        {ultimo ? (
                          <>
                            <span className="cifra tabular-nums">{plata(ultimo.monto)}</span>
                            <div className="cifra text-muted-foreground mt-0.5 text-xs tabular-nums">
                              {fecha(ultimo.pagado_en)}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground text-sm">sin pagos</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex justify-end gap-2">
                          {suscripcion.estado !== 'CANCELADA' && <RenovarSuscripcion suscripcion={suscripcion} />}
                          <EditarSuscripcion suscripcion={suscripcion} planes={planes} />
                          <CambiarEstado suscripcion={suscripcion} />
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
    </>
  );
}
