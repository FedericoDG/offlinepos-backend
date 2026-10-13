import type { Metadata } from 'next';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Badge } from '@/components/ui/badge';
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
import { fecha } from '@/lib/formato';
import { EliminarCadena, ImportarDump, VaciarTodo } from './formularios';

export const metadata: Metadata = { title: 'Precios mayoristas' };
export const dynamic = 'force-dynamic';

/**
 * Precios mayoristas (SEPA).
 *
 * Acá se suben los ZIP que publican los mayoristas y se ve qué quedó cargado.
 * Los comerciantes consultan estos precios desde el chat del POS escribiendo
 * `/consultar-precio` y el producto (ej. `/consultar-precio sal fina`).
 */
export default async function PaginaPreciosMayoristas() {
  const { cadenas } = await consultas.cadenasMayoristas();

  return (
    <>
      <EncabezadoPagina
        titulo="Precios mayoristas"
        descripcion="Los precios de lista que publican los mayoristas (SEPA). Los comerciantes los consultan desde el chat del POS con /consultar-precio y el nombre del producto."
        accion={
          <>
            {cadenas.length > 0 && (
              <VaciarTodo
                cadenas={cadenas.length}
                productos={cadenas.reduce((suma, c) => suma + c.productos, 0)}
              />
            )}
            <ImportarDump />
          </>
        }
      />

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          {cadenas.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Todavía no cargaste ninguna cadena. Importá el ZIP que publica un mayorista para
              que los comerciantes puedan consultar sus precios.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cadena</TableHead>
                  <TableHead className="text-right">Productos</TableHead>
                  <TableHead className="text-right">Sucursales</TableHead>
                  <TableHead>Actualizado por el mayorista</TableHead>
                  <TableHead>Importado</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {cadenas.map((cadena) => (
                  <TableRow key={cadena.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-foreground">{cadena.bandera_nombre}</span>
                        <span className="text-xs text-muted-foreground">
                          {cadena.razon_social} · CUIT {cadena.cuit}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Badge variant="secondary">{cadena.productos.toLocaleString('es-AR')}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {cadena.sucursales}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {cadena.actualizado_sepa_en ? fecha(cadena.actualizado_sepa_en) : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fecha(cadena.importado_en)}
                    </TableCell>
                    <TableCell className="text-right">
                      <EliminarCadena
                        id={cadena.id}
                        nombre={cadena.bandera_nombre}
                        productos={cadena.productos}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
