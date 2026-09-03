import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { numero } from '@/lib/formato';

/**
 * Paginación por links, no por estado del cliente: cada página es una URL. El
 * server component ya recibió solo su página del backend, así que esto no
 * filtra nada, solo navega.
 */
export function Paginacion({
  pagina,
  paginas,
  total,
  limite,
  parametros,
  etiqueta = 'registros',
}: {
  pagina: number;
  paginas: number;
  total: number;
  limite: number;
  /** Los filtros vigentes, para conservarlos al cambiar de página. */
  parametros: Record<string, string | undefined>;
  etiqueta?: string;
}) {
  const desde = total === 0 ? 0 : (pagina - 1) * limite + 1;
  const hasta = Math.min(pagina * limite, total);

  function href(destino: number): string {
    const busqueda = new URLSearchParams();
    for (const [clave, valor] of Object.entries(parametros)) {
      if (valor) busqueda.set(clave, valor);
    }
    if (destino > 1) busqueda.set('pagina', String(destino));
    else busqueda.delete('pagina');
    const cadena = busqueda.toString();
    return cadena ? `?${cadena}` : '?';
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3.5">
      <p className="text-muted-foreground text-sm">
        {total === 0 ? (
          `Sin ${etiqueta}`
        ) : (
          <>
            <span className="cifra tabular-nums">
              {numero(desde)}–{numero(hasta)}
            </span>{' '}
            de <span className="cifra tabular-nums">{numero(total)}</span> {etiqueta}
          </>
        )}
      </p>

      {paginas > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground mr-1 text-sm">
            Página <span className="cifra tabular-nums">{pagina}</span> de{' '}
            <span className="cifra tabular-nums">{paginas}</span>
          </span>
          <Button asChild={pagina > 1} variant="outline" size="icon" disabled={pagina <= 1}>
            {pagina > 1 ? (
              <Link href={href(pagina - 1)} aria-label="Página anterior">
                <ChevronLeft />
              </Link>
            ) : (
              <ChevronLeft />
            )}
          </Button>
          <Button asChild={pagina < paginas} variant="outline" size="icon" disabled={pagina >= paginas}>
            {pagina < paginas ? (
              <Link href={href(pagina + 1)} aria-label="Página siguiente">
                <ChevronRight />
              </Link>
            ) : (
              <ChevronRight />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
