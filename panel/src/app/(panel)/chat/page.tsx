export const dynamic = 'force-dynamic';

import { BarChart3, MessageSquare } from 'lucide-react';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { consultas } from '@/lib/consultas';
import { TablaConsumoChat } from './tabla-consumo';

export default async function PaginaConsumoChat() {
  let datos;

  try {
    datos = await consultas.chatConsumo();
  } catch {
    datos = { resumen: { total_mensajes: 0, total_tokens: 0, total_costo_usd: 0, comercios_activos: 0 }, detalle: [] };
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Consumo del Chat"
        descripcion="Uso mensual del asistente IA por comercio."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-1.5">
            <CardTitle className="text-sm text-muted-foreground">Comercios activos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{datos.resumen.comercios_activos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1.5">
            <CardTitle className="text-sm text-muted-foreground">Total mensajes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{datos.resumen.total_mensajes.toLocaleString('es-AR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1.5">
            <CardTitle className="text-sm text-muted-foreground">Total tokens</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{datos.resumen.total_tokens.toLocaleString('es-AR')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1.5">
            <CardTitle className="text-sm text-muted-foreground flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4" />
              Costo estimado USD
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${datos.resumen.total_costo_usd.toFixed(4)}</p>
          </CardContent>
        </Card>
      </div>

      <TablaConsumoChat datos={datos.detalle} />
    </>
  );
}
