'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Buscador que vive en la URL. El estado no se guarda en React sino en el
 * query string: así el filtro sobrevive a un refresh, se puede compartir el
 * link y el server component vuelve a consultar con el filtro aplicado, que es
 * lo que hace que la paginación sea de verdad del backend.
 */
export function Buscador({ placeholder = 'Buscar…' }: { placeholder?: string }) {
  const router = useRouter();
  const ruta = usePathname();
  const parametros = useSearchParams();
  const [pendiente, iniciarTransicion] = useTransition();

  const [texto, setTexto] = useState(parametros.get('q') ?? '');
  const primeraVez = useRef(true);

  useEffect(() => {
    // Sin este guardia el buscador dispararía una navegación al montarse.
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }

    const temporizador = setTimeout(() => {
      const siguientes = new URLSearchParams(parametros.toString());
      if (texto.trim()) siguientes.set('q', texto.trim());
      else siguientes.delete('q');
      // Cambiar el filtro vuelve a la primera página: quedarse en la 7 de un
      // listado que ahora tiene 2 muestra un vacío que confunde.
      siguientes.delete('pagina');

      iniciarTransicion(() => {
        router.replace(`${ruta}?${siguientes.toString()}`, { scroll: false });
      });
    }, 350);

    return () => clearTimeout(temporizador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <div className="relative w-full max-w-xs">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        placeholder={placeholder}
        className="pr-9 pl-9"
        aria-label={placeholder}
      />
      {pendiente ? (
        <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
      ) : (
        texto && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
            onClick={() => setTexto('')}
          >
            <X />
            <span className="sr-only">Limpiar</span>
          </Button>
        )
      )}
    </div>
  );
}
