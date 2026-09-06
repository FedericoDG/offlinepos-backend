'use client';

import { Badge } from '@/components/ui/badge';
import type { ChatConsumoDetalle } from '@/lib/tipos';

export function TablaConsumoChat({ datos }: { datos: ChatConsumoDetalle[] }) {
  if (datos.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p>No hay consumo de chat registrado este mes.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm text-left">
        <thead className="bg-muted/80 text-foreground font-semibold">
          <tr>
            <th className="px-4 py-3">Comercio</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3 text-right">Mensajes</th>
            <th className="px-4 py-3">Progreso</th>
            <th className="px-4 py-3 text-right">Tokens</th>
            <th className="px-4 py-3 text-right">Costo USD</th>
          </tr>
        </thead>
        <tbody>
          {datos.map((d) => {
            const pct = d.mensajes_limite > 0
              ? Math.round((d.mensajes_usados / d.mensajes_limite) * 100)
              : 0;
            const isIlimitado = d.mensajes_limite === 0;

            return (
              <tr key={d.comercio_id} className="border-t border-border/40 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">{d.comercio}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-xs">
                    {d.plan || 'Sin plan'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {d.mensajes_usados.toLocaleString('es-AR')}
                  {isIlimitado ? '' : ` / ${d.mensajes_limite.toLocaleString('es-AR')}`}
                </td>
                <td className="px-4 py-3">
                  {isIlimitado ? (
                    <span className="text-xs text-muted-foreground">Ilimitado</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground font-mono w-10 text-right">{pct}%</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {d.total_tokens.toLocaleString('es-AR')}
                </td>
                <td className="px-4 py-3 text-right font-mono font-medium">
                  ${d.costo_usd.toFixed(4)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MessageSquare(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}
