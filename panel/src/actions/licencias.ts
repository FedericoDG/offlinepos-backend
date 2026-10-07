'use server';

import { revalidatePath } from 'next/cache';
import { api, esRedireccion, mensajeDeError } from '@/lib/api';
import { ejecutar, leerNumero, type EstadoAccion } from './comun';
import type { ClaveGenerada } from '@/lib/tipos';

/** Claves libres recién generadas, en texto plano para copiar y entregar. */
export interface GenerarClavesEstado extends EstadoAccion {
  licencias?: ClaveGenerada[];
}

/**
 * Genera claves sueltas ("libres"): quedan sin comercio hasta que el alta de un
 * comercio las asigne. No valida cupo — eso pasa al asignarlas — porque una
 * clave libre todavía no pertenece a nadie.
 */
export async function generarClaves(_estado: GenerarClavesEstado, datos: FormData): Promise<GenerarClavesEstado> {
  const cantidad = leerNumero(datos, 'cantidad') ?? 1;

  try {
    const respuesta = await api.post<{ message: string; licencias: ClaveGenerada[] }>('/api/licencias', {
      cantidad,
    });

    revalidatePath('/licencias');

    return {
      ok: true,
      mensaje: respuesta.message ?? 'Claves generadas',
      licencias: respuesta.licencias,
    };
  } catch (error) {
    if (esRedireccion(error)) throw error;
    return { ok: false, error: mensajeDeError(error) };
  }
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

/**
 * Desactivar/reactivar una clave sin perderla. El escritorio rechaza la
 * activación con 403 mientras siga suspendida; es la alternativa a borrarla.
 */
export async function cambiarEstadoLicencia(
  licenciaId: string,
  estado: 'activa' | 'suspendida',
  comercioId?: string
): Promise<EstadoAccion> {
  const resultado = await ejecutar(estado === 'activa' ? 'Clave activada' : 'Clave desactivada', () =>
    api.patch(`/api/licencias/${licenciaId}/estado`, { estado })
  );

  if (resultado.ok) {
    revalidatePath('/licencias');
    // La acción también se usa desde el detalle del comercio: hay que refrescarlo.
    if (comercioId) revalidatePath(`/comercios/${comercioId}`);
  }

  return resultado;
}

/**
 * Borra una clave sin referencias. Si tiene activaciones o consumos de chat el
 * backend responde 409 con el motivo, y ese mensaje llega tal cual al toast.
 */
export async function eliminarLicencia(licenciaId: string, comercioId?: string): Promise<EstadoAccion> {
  const resultado = await ejecutar('Clave eliminada', () => api.delete(`/api/licencias/${licenciaId}`));

  if (resultado.ok) {
    revalidatePath('/licencias');
    if (comercioId) revalidatePath(`/comercios/${comercioId}`);
  }

  return resultado;
}
