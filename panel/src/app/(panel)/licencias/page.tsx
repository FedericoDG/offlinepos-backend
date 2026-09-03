import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Buscador } from '@/components/panel/buscador';
import { Paginacion } from '@/components/panel/paginacion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha } from '@/lib/formato';
import { CopiarClave, EmitirLicencia, LiberarActivaciones } from './formularios';

export const metadata: Metadata = { title: 'Licencias' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 20;

export default async function PaginaLicencias({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { q, pagina } = await searchParams;
  const paginaActual = Math.max(1, Number(pagina) || 1);

  // El listado viene paginado del backend: solo llegan las 20 filas de esta
  // página, no la tabla entera para filtrar en el navegador.
  const [licencias, comercios, suscripciones] = await Promise.all([
    consultas.licencias({ q, pagina: paginaActual, limite: POR_PAGINA }),
    consultas.comercios(),
    consultas.suscripciones(),
  ]);

  return (
    <>
      <EncabezadoPagina
        titulo="Licencias emitidas"
        descripcion="Las emite la suscripción según el cupo del plan. Una de rol servidor por caja; las de rol cliente son las terminales que se cuelgan de ella."
        accion={<EmitirLicencia comercios={comercios} suscripciones={suscripciones} />}
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
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Activaciones</TableHead>
                <TableHead>Emitida</TableHead>
                <TableHead className="pr-6 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licencias.datos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground h-28 text-center">
                    {q
                      ? `Ningún comercio que coincida con «${q}» tiene licencias emitidas.`
                      : 'Todavía no se emitió ninguna licencia.'}
                  </TableCell>
                </TableRow>
              ) : (
                licencias.datos.map((licencia) => (
                  <TableRow key={licencia.id}>
                    <TableCell className="pl-6 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono text-xs">{licencia.clave_original ?? '(no descifrable)'}</code>
                        {licencia.clave_original && <CopiarClave clave={licencia.clave_original} />}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">{licencia.comercio.nombre}</TableCell>
                    <TableCell>
                      <Badge variant={licencia.rol === 'SERVIDOR' ? 'info' : 'secondary'}>{licencia.rol}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={licencia.estado === 'activa' ? 'success' : 'danger'}>{licencia.estado}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="cifra tabular-nums">{licencia.activaciones.length}</span>
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        usadas &middot; {licencia.max_activaciones} disponibles
                      </span>
                    </TableCell>
                    <TableCell className="cifra text-muted-foreground tabular-nums">
                      {fecha(licencia.createdAt)}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <LiberarActivaciones licencia={licencia} />
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
            etiqueta="licencias"
          />
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-4 max-w-2xl text-xs leading-relaxed">
        «Disponibles» es el cupo que queda: el backend descuenta uno cada vez que una instalación nueva activa la
        clave. Reinstalar la misma máquina no consume cupo. Si el comercio cambió de PC, entrá a{' '}
        <span className="text-foreground">Instalaciones</span> y liberá la vieja: recupera el cupo sin cambiarle la
        clave. Una licencia en <span className="text-foreground">suspendida</span> es una que el plan actual del
        comercio ya no cubre: vuelve sola a activa si le subís el plan.
      </p>
    </>
  );
}
