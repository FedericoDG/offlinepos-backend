import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Buscador } from '@/components/panel/buscador';
import { Paginacion } from '@/components/panel/paginacion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha } from '@/lib/formato';
import { Copy } from 'lucide-react';
import { AccionesLicencia, CopiarClave, GenerarClaves, LiberarActivaciones } from './formularios';

export const metadata: Metadata = { title: 'Claves' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 20;

/** Enmascara todo menos el primer grupo de la clave (`X7KP-••••-••••`). */
function enmascararClave(clave: string | null): string {
  if (!clave) return '(no disponible)';
  const partes = clave.split('-');
  if (partes.length < 2) return '••••••••';
  return [partes[0], ...partes.slice(1).map(() => '••••')].join('-');
}

export default async function PaginaClaves({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { q, pagina } = await searchParams;
  const paginaActual = Math.max(1, Number(pagina) || 1);

  // El listado viene paginado del backend: solo llegan las 20 filas de esta
  // página. Trae tanto claves libres como asignadas.
  const licencias = await consultas.licencias({ q, pagina: paginaActual, limite: POR_PAGINA });

  return (
    <>
      <EncabezadoPagina
        titulo="Claves"
        descripcion="Generá claves sueltas y asignalas al crear un comercio. Una clave sin comercio está libre y no se puede activar."
        accion={<GenerarClaves />}
      />

      <div className="mb-4">
        <Suspense fallback={null}>
          <Buscador placeholder="Buscar por comercio…" />
        </Suspense>
      </div>

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Clave</TableHead>
                <TableHead>Comercio</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Activaciones</TableHead>
                <TableHead>Generada</TableHead>
                <TableHead className="pr-6 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licencias.datos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground h-28 text-center">
                    {q
                      ? `Ningún comercio que coincida con «${q}» tiene claves asignadas.`
                      : 'Todavía no se generó ninguna clave.'}
                  </TableCell>
                </TableRow>
              ) : (
                licencias.datos.map((licencia) => (
                  <TableRow key={licencia.id}>
                    <TableCell className="pl-6 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <code className="text-muted-foreground font-mono text-xs">
                          {enmascararClave(licencia.clave_original)}
                        </code>
                        {licencia.clave_original ? (
                          <CopiarClave clave={licencia.clave_original} />
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled
                            title="Clave no recuperable (formato viejo)"
                          >
                            <Copy />
                            <span className="sr-only">Clave no recuperable</span>
                          </Button>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      {licencia.comercio?.nombre ?? <span className="text-muted-foreground font-normal">—</span>}
                    </TableCell>
                    <TableCell>
                      {licencia.comercio ? (
                        <Badge variant={licencia.estado === 'activa' ? 'success' : 'danger'}>{licencia.estado}</Badge>
                      ) : (
                        <Badge variant="warning">libre</Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {licencia.comercio ? (
                        <>
                          <span className="cifra tabular-nums">{licencia.activaciones.length}</span>
                          <span className="text-muted-foreground ml-1.5 text-xs">
                            usadas &middot; {licencia.max_activaciones} disponibles
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-xs">sin asignar</span>
                      )}
                    </TableCell>
                    <TableCell className="cifra text-muted-foreground tabular-nums">
                      {fecha(licencia.createdAt)}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <LiberarActivaciones licencia={licencia} />
                        <AccionesLicencia licencia={licencia} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <Paginacion
            pagina={licencias.pagina}
            paginas={licencias.paginas}
            total={licencias.total}
            limite={licencias.limite}
            parametros={{ q }}
            etiqueta="claves"
          />
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-4 max-w-2xl text-xs leading-relaxed">
        Una clave <span className="text-foreground">libre</span> todavía no pertenece a ningún comercio y no se puede
        activar: asignala al crear un comercio. «Disponibles» es el cupo que queda: el backend descuenta uno cada vez
        que una instalación nueva activa la clave. Si el comercio cambió de PC, entrá a{' '}
        <span className="text-foreground">Instalaciones</span> y liberá la vieja: recupera el cupo sin cambiarle la
        clave. Una clave en <span className="text-foreground">suspendida</span> es una que el plan actual del comercio
        ya no cubre: vuelve sola a activa si le subís el plan.
      </p>
    </>
  );
}
