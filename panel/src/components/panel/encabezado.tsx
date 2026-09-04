import type { ReactNode } from 'react';

/** Encabezado de página con el ritmo tipográfico de shadcn. */
export function EncabezadoPagina({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  accion?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descripcion && <p className="text-muted-foreground max-w-2xl text-sm">{descripcion}</p>}
      </div>
      {accion}
    </header>
  );
}
