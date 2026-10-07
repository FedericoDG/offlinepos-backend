import type { Metadata } from 'next';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Card, CardContent } from '@/components/ui/card';
import { consultas } from '@/lib/consultas';
import { FormularioAltaComercio } from './formulario';

export const metadata: Metadata = { title: 'Nuevo comercio' };
export const dynamic = 'force-dynamic';

/**
 * Alta en un paso: nombre + plan + claves libres a asignar. El backend crea el
 * comercio, le asigna el plan y valida el cupo sobre las claves elegidas.
 */
export default async function PaginaAltaComercio() {
  const [planes, clavesLibres] = await Promise.all([
    consultas.planes(true),
    consultas.licencias({ libres: 1, limite: 100 }),
  ]);

  const planesActivos = planes.filter((plan) => plan.activo);

  return (
    <>
      <EncabezadoPagina
        titulo="Nuevo comercio"
        descripcion="Creá el comercio, asignale un plan y elegí las claves libres que va a usar. El cupo del plan se valida sobre las claves que asignes."
      />

      <Card>
        <CardContent>
          {planesActivos.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No hay planes activos. Creá uno en <span className="text-foreground">Planes</span> antes de dar de alta un
              comercio.
            </p>
          ) : (
            <FormularioAltaComercio planes={planesActivos} claves={clavesLibres.datos} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
