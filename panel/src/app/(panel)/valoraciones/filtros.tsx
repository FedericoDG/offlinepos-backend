'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Filtros de la pantalla de valoraciones. Igual que el buscador del panel, el
 * estado vive en la URL: así el server component vuelve a consultar con el
 * filtro aplicado y el link se puede compartir. El detalle ya es, por diseño,
 * solo negativas, así que el único filtro es el período.
 */
export function FiltrosValoraciones() {
  const router = useRouter();
  const ruta = usePathname();
  const parametros = useSearchParams();
  const [pendiente, iniciarTransicion] = useTransition();

  const periodo = parametros.get('periodo') ?? '';

  function aplicar(cambios: Record<string, string | null>) {
    const siguientes = new URLSearchParams(parametros.toString());
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) siguientes.set(clave, valor);
      else siguientes.delete(clave);
    }
    iniciarTransicion(() => {
      router.replace(`${ruta}?${siguientes.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="periodo" className="text-muted-foreground">
          Período
        </Label>
        <Input
          id="periodo"
          type="month"
          value={periodo}
          onChange={(evento) => aplicar({ periodo: evento.target.value || null })}
          className="w-44"
          aria-label="Filtrar por período"
        />
      </div>

      {pendiente && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
    </div>
  );
}
