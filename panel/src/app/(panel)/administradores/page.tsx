import type { Metadata } from 'next';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { consultas } from '@/lib/consultas';
import { fecha } from '@/lib/formato';
import { leerSesion } from '@/lib/sesion';
import { AccionesAdministrador, NuevoAdministrador } from './formularios';

export const metadata: Metadata = { title: 'Administradores' };
export const dynamic = 'force-dynamic';

export default async function PaginaAdministradores() {
  const [administradores, sesion] = await Promise.all([consultas.administradores(), leerSesion()]);
  const emailActual = sesion?.administrador.email.toLowerCase();

  return (
    <>
      <EncabezadoPagina
        titulo="Administradores"
        descripcion="Quiénes pueden entrar al panel. Un administrador desactivado no puede iniciar sesión y su sesión viva deja de servir."
        accion={<NuevoAdministrador />}
      />

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Alta</TableHead>
                <TableHead className="pr-6 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {administradores.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground h-28 text-center">
                    No hay administradores cargados.
                  </TableCell>
                </TableRow>
              ) : (
                administradores.map((administrador) => {
                  const esActual = administrador.email.toLowerCase() === emailActual;

                  return (
                    <TableRow key={administrador.id}>
                      <TableCell className="pl-6 font-medium whitespace-nowrap">
                        {administrador.email}
                        {esActual && (
                          <Badge variant="info" className="ml-2">
                            vos
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{administrador.rol}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={administrador.activo ? 'success' : 'danger'}>
                          {administrador.activo ? 'activo' : 'desactivado'}
                        </Badge>
                      </TableCell>
                      <TableCell className="cifra text-muted-foreground tabular-nums">
                        {fecha(administrador.createdAt)}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <AccionesAdministrador administrador={administrador} esActual={esActual} />
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
