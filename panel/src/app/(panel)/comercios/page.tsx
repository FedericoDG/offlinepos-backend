import type { Metadata } from 'next';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { EstadoDeSuscripcion } from '@/components/panel/estado-suscripcion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha, plata, vencimiento } from '@/lib/formato';
import { EliminarComercio, NuevoComercio, RenombrarComercio } from './formularios';

export const metadata: Metadata = { title: 'Comercios' };
export const dynamic = 'force-dynamic';

export default async function PaginaComercios() {
  const [comercios, suscripciones] = await Promise.all([consultas.comercios(), consultas.suscripciones()]);

  // Índice por comercio: un comercio tiene a lo sumo una suscripción viva.
  const porComercio = new Map(suscripciones.map((s) => [s.comercio.id, s]));

  return (
    <>
      <EncabezadoPagina
        titulo="Comercios"
        descripcion="Quiénes usan el POS, con qué licencias y bajo qué suscripción. El alta es en dos pasos: primero el comercio, después el plan."
        accion={<NuevoComercio />}
      />

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Comercio</TableHead>
                <TableHead>Licencias</TableHead>
                <TableHead>Suscripción</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Alta</TableHead>
                <TableHead className="pr-6 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comercios.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground h-28 text-center">
                    Todavía no hay comercios cargados.
                  </TableCell>
                </TableRow>
              ) : (
                comercios.map((comercio) => {
                  const servidores = comercio.licencias.filter((l) => l.rol === 'SERVIDOR').length;
                  const clientes = comercio.licencias.filter((l) => l.rol === 'CLIENTE').length;
                  const suscripcion = porComercio.get(comercio.id);

                  return (
                    <TableRow key={comercio.id}>
                      <TableCell className="pl-6 font-medium">{comercio.nombre}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={servidores > 0 ? 'info' : 'secondary'}>{servidores} servidor</Badge>
                          <Badge variant="secondary">{clientes} cliente</Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {suscripcion ? (
                          <div className="flex items-center gap-2">
                            <EstadoDeSuscripcion estado={suscripcion.estado_efectivo} />
                            <span className="text-muted-foreground text-sm">{suscripcion.plan?.nombre ?? '—'}</span>
                          </div>
                        ) : (
                          <span className="text-[var(--warning)] text-sm">sin plan contratado</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {suscripcion ? (
                          <>
                            <span className="cifra tabular-nums">{fecha(suscripcion.vence_en)}</span>
                            <span className="text-muted-foreground ml-2 text-xs">
                              {vencimiento(suscripcion.dias_restantes)}
                            </span>
                            <div className="cifra text-muted-foreground mt-0.5 text-xs tabular-nums">
                              {plata(suscripcion.precio_pactado)} / {suscripcion.ciclo.toLowerCase()}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="cifra text-muted-foreground tabular-nums">
                        {fecha(comercio.createdAt)}
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex justify-end gap-2">
                          <RenombrarComercio comercio={comercio} />
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
        Eliminar un comercio borra en cascada sus licencias, activaciones, suscripción y el historial de pagos. Si la
        idea es dar de baja el servicio sin perder la cobranza, cancelá la suscripción desde{' '}
        <span className="text-foreground">Suscripciones</span>.
      </p>
    </>
  );
}
