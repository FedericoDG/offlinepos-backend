'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';
import { Alert, AlertDescription } from './alert';
import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { FieldGroup } from './field';
import type { EstadoAccion } from '@/actions/comun';

function BotonGuardar({ texto, bloqueado }: { texto: string; bloqueado?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || bloqueado}>
      {pending ? 'Guardando...' : texto}
    </Button>
  );
}

/**
 * Formulario dentro de un Dialog. Centraliza las tres cosas que todos los ABM
 * del panel hacen igual: correr la server action, avisar el resultado y
 * cerrarse solo cuando salió bien (si falló, el diálogo queda abierto con lo
 * que la persona escribió, que es lo que uno espera).
 */
export function AccionModal({
  disparador,
  titulo,
  descripcion,
  accion,
  textoGuardar = 'Guardar',
  ancho = 'sm:max-w-lg',
  bloqueo,
  children,
}: {
  disparador: ReactNode;
  titulo: string;
  descripcion?: string;
  accion: (estado: EstadoAccion, datos: FormData) => Promise<EstadoAccion>;
  textoGuardar?: string;
  ancho?: string;
  /**
   * Motivo por el que la operación no se puede hacer. Con esto puesto el botón
   * de guardar queda deshabilitado y se muestra el motivo: es el mismo que
   * devolvería el backend, adelantado para no hacer viajar un formulario que
   * ya sabemos que va a ser rechazado.
   */
  bloqueo?: string;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, ejecutar] = useActionState(accion, {});
  const ultimo = useRef<EstadoAccion | null>(null);

  useEffect(() => {
    // Sin este guardia el aviso se repetiría en cada render del diálogo.
    if (estado === ultimo.current || (!estado.ok && !estado.error)) return;
    ultimo.current = estado;

    if (estado.ok) {
      toast.success(estado.mensaje ?? 'Listo');
      setAbierto(false);
    } else if (estado.error) {
      toast.error(estado.error);
    }
  }, [estado]);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>{disparador}</DialogTrigger>
      <DialogContent className={ancho}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descripcion && <DialogDescription>{descripcion}</DialogDescription>}
        </DialogHeader>

        <form action={ejecutar} className="grid gap-6">
          <FieldGroup>{children}</FieldGroup>

          {bloqueo && (
            <Alert variant="destructive">
              <AlertDescription>{bloqueo}</AlertDescription>
            </Alert>
          )}

          {estado.error && (
            <Alert variant="destructive">
              <AlertDescription>{estado.error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <BotonGuardar texto={textoGuardar} bloqueado={Boolean(bloqueo)} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
