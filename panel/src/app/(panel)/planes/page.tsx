import type { Metadata } from 'next';
import { MessageSquare, Monitor } from 'lucide-react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { consultas } from '@/lib/consultas';
import { plata } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { AlternarPlan, EditarPlan, NuevoPlan } from './formularios';

export const metadata: Metadata = { title: 'Planes' };
export const dynamic = 'force-dynamic';

export default async function PaginaPlanes() {
  const planes = await consultas.planes();

  return (
    <>
      <EncabezadoPagina
        titulo="Tipos de suscripción"
        descripcion="Lo que se vende. El cupo de servidores de cada plan es el que después limita cuántas licencias se le emiten al comercio."
        accion={<NuevoPlan />}
      />

      {planes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Sin planes cargados</p>
            <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
              Corré <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">npx tsx prisma/seed-panel.ts</code>{' '}
              en el backend para crear Básico y Pro, o cargalos a mano con el botón de arriba.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {planes.map((plan) => (
            <Card key={plan.id} className={cn('gap-4', !plan.activo && 'opacity-60')}>
              <CardHeader>
                <CardTitle className="truncate text-lg" title={plan.nombre}>
                  {plan.nombre}
                </CardTitle>
                <p className="text-muted-foreground font-mono text-xs">{plan.codigo}</p>
                <CardAction>
                  <Badge variant={plan.activo ? 'success' : 'secondary'}>
                    {plan.activo ? 'En venta' : 'Discontinuado'}
                  </Badge>
                </CardAction>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="cifra text-3xl font-semibold tabular-nums">{plata(plan.precio_mensual)}</span>
                  <span className="text-muted-foreground text-sm">/ mes</span>
                </div>
                {plan.precio_anual !== null && (
                  <p className="text-muted-foreground -mt-3 text-xs">{plata(plan.precio_anual)} al año</p>
                )}

                {plan.descripcion && <p className="text-muted-foreground text-sm">{plan.descripcion}</p>}

                <div className="grid gap-2 border-t pt-4 text-sm">
                  <div className="flex items-center gap-2.5">
                    <Monitor className="text-primary size-4" />
                    <span className="cifra font-medium tabular-nums">{plan.max_servidores}</span>
                    <span className="text-muted-foreground">
                      {plan.max_servidores === 1 ? 'servidor' : 'servidores'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <MessageSquare className="text-primary size-4" />
                    {plan.chat_mensajes_mes === 0 ? (
                      <span className="font-medium">Ilimitados</span>
                    ) : (
                      <span className="cifra font-medium tabular-nums">{plan.chat_mensajes_mes}</span>
                    )}
                    <span className="text-muted-foreground">mensajes de Binny / mes</span>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="justify-between border-t">
                <span className="text-muted-foreground text-xs">
                  {plan.comercios_con_plan} {plan.comercios_con_plan === 1 ? 'comercio con este plan' : 'comercios con este plan'}
                </span>
                <div className="flex gap-2">
                  <AlternarPlan plan={plan} />
                  <EditarPlan plan={plan} />
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
