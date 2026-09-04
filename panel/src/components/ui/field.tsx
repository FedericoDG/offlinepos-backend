import * as React from 'react';

import { cn } from '@/lib/utils';
import { Label } from './label';

/**
 * Bloque de formulario de shadcn: etiqueta, control, texto de ayuda y error.
 * Evita repetir el mismo grid en cada campo de cada ABM.
 */
function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-group" className={cn('grid gap-5', className)} {...props} />;
}

function FieldRow({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field-row" className={cn('grid items-start gap-5 sm:grid-cols-2', className)} {...props} />;
}

function Field({
  label,
  description,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  description?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="field" className={cn('grid content-start gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {description && !error && <p className="text-muted-foreground text-xs">{description}</p>}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

export { Field, FieldGroup, FieldRow };
