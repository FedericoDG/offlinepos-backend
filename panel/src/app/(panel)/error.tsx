'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function ErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[panel]', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>No se pudo cargar la sección</AlertTitle>
        <AlertDescription>
          <p>{error.message}</p>
          <p className="text-muted-foreground">
            Si dice que no se pudo conectar, revisá que el backend esté corriendo en el puerto 4000 y que la base de
            datos de Docker esté levantada.
          </p>
        </AlertDescription>
      </Alert>
      <Button variant="outline" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
