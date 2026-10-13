import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowLeft } from 'lucide-react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Buscador } from '@/components/panel/buscador';
import { Paginacion } from '@/components/panel/paginacion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha, numero, plata } from '@/lib/formato';

export const dynamic = 'force-dynamic';

const POR_PAGINA = 25;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const { cadena } = await consultas.productosDeCadena(id, { limite: 5 });
    return { title: cadena.bandera_nombre };
  } catch {
    return { title: 'Precios mayoristas' };
  }
}

/**
 * Productos de una cadena, paginados y con buscador.
 *
 * 10.800 productos no se pueden listar de una: se muestra de a páginas y se
 * puede buscar por nombre, marca o código de barras.
 */
export default async function PaginaProductosDeCadena({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; pagina?: string }>;
}) {
  const { id } = await params;
  const { q, pagina } = await searchParams;
  const paginaActual = Math.max(1, Number(pagina) || 1);

  const { cadena, datos, total, paginas, pagina: actual, limite } =
    await consultas.productosDeCadena(id, { q, pagina: paginaActual, limite: POR_PAGINA });

  return (
    <>
      <EncabezadoPagina
        titulo={cadena.bandera_nombre}
        descripcion={`${cadena.razon_social} · CUIT ${cadena.cuit} · ${numero(total)} productos en ${cadena.bandera_url ?? 'su catálogo'}`}
        accion={
          <Button asChild variant="outline">
            <Link href="/precios-mayoristas">
              <ArrowLeft /> Volver
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Suspense fallback={null}>
          <Buscador placeholder="Buscar por producto, marca o código de barras…" />
        </Suspense>
        {cadena.actualizado_sepa_en && (
          <span className="text-xs text-muted-foreground">
            El mayorista lo actualizó el {fecha(cadena.actualizado_sepa_en)} · importado el{' '}
            {fecha(cadena.importado_en)}
          </span>
        )}
      </div>

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          {datos.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              {q
                ? `No hay productos que coincidan con “${q}”.`
                : 'Esta cadena no tiene productos cargados.'}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Código</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Precio (con IVA)</TableHead>
                    <TableHead className="text-right">Sucursales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datos.map((p) => (
                    <TableRow key={p.ean}>
                      <TableCell className="pl-6 font-mono text-xs text-muted-foreground">
                        {p.ean}
                        {!p.es_ean && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            interno
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">{p.descripcion}</span>
                          {p.marca && p.marca !== 'Sin marca' && (
                            <span className="text-xs text-muted-foreground">{p.marca}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="font-medium">{plata(p.precio_con_iva, true)}</span>
                        {p.precio_max > p.precio_min && (
                          <span className="block text-xs text-muted-foreground">
                            entre {plata(p.precio_min, true)} y {plata(p.precio_max, true)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {p.sucursales}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Paginacion
                pagina={actual}
                paginas={paginas}
                total={total}
                limite={limite}
                parametros={{ q }}
                etiqueta="productos"
              />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
