import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { fecha } from '@/lib/formato';
import type { ValoracionDetalle } from '@/lib/tipos';

/**
 * Lista de valoraciones negativas. Cada fila es una tarjeta con el caso
 * completo: la pregunta siempre visible y la respuesta desplegable (puede ser
 * larga). El `<details>` nativo evita estado en el cliente para algo que es
 * puro mostrar.
 */
export function ListaValoraciones({ datos }: { datos: ValoracionDetalle[] }) {
  if (datos.length === 0) {
    return (
      <Card className="items-center py-12 text-center">
        <ThumbsUp className="text-muted-foreground mx-auto mb-3 size-8 opacity-40" />
        <p className="text-muted-foreground">
          No hay valoraciones negativas en este período. Buen síntoma.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {datos.map((v) => {
        const negativa = v.valoracion < 0;
        return (
          <Card key={v.id} className="gap-0 py-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-5 py-3">
              <Badge variant={negativa ? 'danger' : 'success'}>
                {negativa ? <ThumbsDown /> : <ThumbsUp />}
                {negativa ? '👎 Negativa' : '👍 Positiva'}
              </Badge>
              <span className="text-sm font-medium">{v.comercio}</span>
              {v.fuente && (
                <Badge variant="outline" className="text-xs">
                  {v.fuente}
                </Badge>
              )}
              <span className="cifra text-muted-foreground ml-auto text-xs tabular-nums">
                {fecha(v.fecha)}
              </span>
            </div>

            <div className="px-5 py-4">
              <p className="text-sm font-medium">{v.pregunta}</p>
              <details className="group mt-2">
                <summary className="text-primary w-fit cursor-pointer text-xs font-medium select-none">
                  Ver respuesta
                </summary>
                <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">
                  {v.respuesta}
                </p>
              </details>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
