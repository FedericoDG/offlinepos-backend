'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { ejecutar, leerNumero, leerTexto, type EstadoAccion } from './comun';

/**
 * Emite una licencia sobre un comercio que ya existe. Si no se escribe la
 * clave, el backend genera una unica con el formato LIC-AAAA-XXXX-XXXX.
 */
export async function emitirLicencia(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const clave = leerTexto(datos, 'clave');

  const resultado = await ejecutar('Licencia emitida', () =>
    api.post('/api/licencias', {
      comercio_id: leerTexto(datos, 'comercio_id'),
      rol: (leerTexto(datos, 'rol') ?? 'SERVIDOR') as 'SERVIDOR' | 'CLIENTE',
      max_activaciones: leerNumero(datos, 'max_activaciones') ?? 1,
      ...(clave ? { clave } : {}),
    })
  );

  if (resultado.ok) {
    revalidatePath('/licencias');
    revalidatePath('/comercios');
    revalidatePath('/dashboard');
  }

  return resultado;
}

/**
 * Cambio de PC. Libera el puesto que ocupaba la máquina vieja y le devuelve el
 * cupo a la licencia, para que el comercio active la misma clave en la nueva.
 *
 * No se emite una licencia de reemplazo a propósito: eso dejaría al comercio
 * con dos licencias activas para un plan que cubre una sola.
 */
export async function liberarActivacion(licenciaId: string, activacionId: string): Promise<EstadoAccion> {
  const resultado = await ejecutar('Instalación liberada. Ya puede activar la clave en la máquina nueva.', () =>
    api.delete(`/api/licencias/${licenciaId}/activaciones/${activacionId}`)
  );

  if (resultado.ok) {
    revalidatePath('/licencias');
    revalidatePath('/comercios');
  }

  return resultado;
}
