import type { Metadata } from 'next';
import { Download } from 'lucide-react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha } from '@/lib/formato';
import { EliminarVersion, PublicarVersion } from './formularios';

export const metadata: Metadata = { title: 'Actualizaciones' };
export const dynamic = 'force-dynamic';

function tamano(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function PaginaActualizaciones() {
  const vigente = await consultas.actualizacionVigente();

  return (
    <>
      <EncabezadoPagina
        titulo="Actualizaciones del POS"
        descripcion="La versión publicada acá es la que ofrecen los updater de las cajas al abrir. Los instaladores se construyen y firman afuera (CI) y se suben ya firmados."
        accion={<PublicarVersion />}
      />

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          {!vigente.version ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Todavía no se publicó ninguna versión. Publicá la primera para que las cajas empiecen a ofrecerse.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 px-6 py-5">
                <Badge>v{vigente.version}</Badge>
                <span className="text-sm text-muted-foreground">
                  Publicada el {fecha(vigente.pub_date)}
                </span>
              </div>
              {vigente.notas && (
                <p className="px-6 pb-4 text-sm whitespace-pre-wrap">{vigente.notas}</p>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Archivo</TableHead>
                    <TableHead>Tamaño</TableHead>
                    <TableHead>Descarga</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vigente.archivos.map((a) => (
                    <TableRow key={a.nombre}>
                      <TableCell className="font-mono text-xs">{a.nombre}</TableCell>
                      <TableCell>{tamano(a.bytes)}</TableCell>
                      <TableCell>
                        <a
                          href={a.url}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Download className="size-3.5" /> Descargar
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      {vigente.versiones.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-sm font-semibold">Historial de versiones en disco</h2>
          <Card className="gap-0 py-0">
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Versión</TableHead>
                    <TableHead>Tamaño</TableHead>
                    <TableHead className="w-24 text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vigente.versiones.map((v) => (
                    <TableRow key={v.version}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold">v{v.version}</span>
                          {v.esVigente && <Badge>Vigente</Badge>}
                        </span>
                      </TableCell>
                      <TableCell>{tamano(v.bytes)}</TableCell>
                      <TableCell className="text-right">
                        <EliminarVersion version={v.version} esVigente={v.esVigente} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
