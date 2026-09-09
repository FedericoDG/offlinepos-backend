'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { ejecutar, leerTexto, type EstadoAccion } from './comun';
import type { VersionVigente } from '@/lib/tipos';

/**
 * Publica una versión del POS: los instaladores ya firmados viajan en el
 * FormData (multipart) y el backend los guarda y regenera latest.json.
 * Los archivos llegan como File de Next: se reenvían tal cual en un
 * FormData nuevo (api.subir no pisa el Content-Type con boundary).
 */
export async function publicarVersion(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const version = leerTexto(datos, 'version');
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    return { ok: false, error: 'La versión debe tener formato semver (ej. 0.1.4)' };
  }

  const reenvio = new FormData();
  reenvio.set('version', version);
  const notas = leerTexto(datos, 'notas');
  if (notas) reenvio.set('notas', notas);
  for (const campo of ['setup', 'setupFirma', 'msi', 'msiFirma'] as const) {
    const archivo = datos.get(campo);
    if (archivo instanceof File && archivo.size > 0) {
      reenvio.set(campo, archivo, archivo.name);
    }
  }

  const resultado = await ejecutar(
    (r: VersionVigente) => `Versión ${r.version} publicada correctamente`,
    () => api.subir<VersionVigente>('/api/updates/admin/subir', reenvio)
  );

  if (resultado.ok) {
    revalidatePath('/actualizaciones');
  }

  return resultado;
}

/**
 * Elimina una versión completa del disco. Si era la vigente, también cae
 * latest.json y el sistema queda sin versión publicada (las cajas dejan de
 * ver actualizaciones hasta que se publique una nueva).
 */
export async function eliminarVersion(version: string): Promise<EstadoAccion> {
  const resultado = await ejecutar(
    `Versión ${version} eliminada por completo`,
    () => api.delete(`/api/updates/admin/versiones/${encodeURIComponent(version)}`)
  );

  if (resultado.ok) {
    revalidatePath('/actualizaciones');
  }

  return resultado;
}
