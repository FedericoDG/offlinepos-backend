'use client';

import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from './button';
import type { EstadoAccion } from '@/actions/comun';

/**
 * Botón para acciones directas (cancelar, desactivar, borrar). Cuando se le
 * pasa `confirmacion` exige un segundo clic con el texto de confirmación a la
 * vista, en vez de abrir un `confirm()` del navegador — que además bloquea la
 * pestaña entera.
 */
export function BotonAccion({
  accion,
  confirmacion,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  accion: () => Promise<EstadoAccion>;
  confirmacion?: string;
  children: ReactNode;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function correr() {
    if (confirmacion && !confirmando) {
      setConfirmando(true);
      setTimeout(() => setConfirmando(false), 4000);
      return;
    }

    setCargando(true);
    try {
      const resultado = await accion();
      if (resultado.ok) toast.success(resultado.mensaje ?? 'Listo');
      else toast.error(resultado.error ?? 'No se pudo completar');
    } finally {
      setCargando(false);
      setConfirmando(false);
    }
  }

  return (
    <Button {...props} disabled={cargando} onClick={correr}>
      {cargando ? '...' : confirmando ? confirmacion : children}
    </Button>
  );
}
