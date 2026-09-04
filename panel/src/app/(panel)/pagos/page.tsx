import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Buscador } from '@/components/panel/buscador';
import { Paginacion } from '@/components/panel/paginacion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha, plata } from '@/lib/formato';
import { EliminarPago, RegistrarPago } from './formularios';

export const metadata: Metadata = { title: 'Pagos' };
export const dynamic = 'force-dynamic';

const POR_PAGINA = 20;

const NOMBRE_METODO: Record<string, string> = {
  TRANSFERENCIA: 'Transferencia',
  EFECTIVO: 'Efectivo',
  MERCADO_PAGO: 'Mercado Pago',
  TARJETA: 'Tarjeta',
  OTRO: 'Otro',
};

export default async function PaginaPagos({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { q, pagina } = await searchParams;
  const paginaActual = Math.max(1, Number(pagina) || 1);

  const [pagos, suscripciones] = await Promise.all([
    consultas.pagos({ q, pagina: paginaActual, limite: POR_PAGINA }),
    consultas.suscripciones(),
  ]);

  const vivas = suscripciones.filter((s) => s.estado !== 'CANCELADA');

  return (
    <>
      <EncabezadoPagina
        titulo="Cobranza"
        descripcion="Todo lo que entró, con la fecha real del cobro y el período que cubre."
        accion={<RegistrarPago suscripciones={vivas} />}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <Suspense fallback={null}>
          <Buscador placeholder="Buscar por comercio…" />
        </Suspense>
      </div>

      <Card className="mb-4 gap-2 py-5">
        <CardHeader className="px-5">
          <CardDescription>{q ? `Cobrado de «${q}»` : 'Cobrado histórico'}</CardDescription>
          <CardTitle className="cifra text-primary text-3xl font-semibold tabular-nums">
            {plata(pagos.total_monto)}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground px-5 text-xs">
          {/* La suma la calcula el backend sobre todo lo filtrado, no sobre la
              página visible: si no, cambiar de página cambiaría el total. */}
          Suma de los {pagos.total} cobros que coinciden con el filtro, no solo de los que se ven acá. El corte por
          mes está en el dashboard.
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Fecha</TableHead>
                <TableHead>Comercio</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Período cubierto</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead className="pr-6 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagos.datos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground h-28 text-center">
                    {q ? `Ningún cobro de un comercio que coincida con «${q}».` : 'Todavía no se registró ningún pago.'}
                  </TableCell>
                </TableRow>
              ) : (
                pagos.datos.map((pago) => (
                  <TableRow key={pago.id}>
                    <TableCell className="cifra pl-6 whitespace-nowrap tabular-nums">
                      {fecha(pago.pagado_en)}
                    </TableCell>
                    <TableCell className="font-medium">{pago.suscripcion?.comercio.nombre ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{pago.suscripcion?.plan?.nombre ?? '—'}</TableCell>
                    <TableCell className="cifra text-right tabular-nums">{plata(pago.monto)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{NOMBRE_METODO[pago.metodo] ?? pago.metodo}</Badge>
                    </TableCell>
                    <TableCell className="cifra text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                      {fecha(pago.periodo_desde)} &rarr; {fecha(pago.periodo_hasta)}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{pago.referencia ?? '—'}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <EliminarPago id={pago.id} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <Paginacion
            pagina={pagos.pagina}
            paginas={pagos.paginas}
            total={pagos.total}
            limite={pagos.limite}
            parametros={{ q }}
            etiqueta="cobros"
          />
        </CardContent>
      </Card>
    </>
  );
}
