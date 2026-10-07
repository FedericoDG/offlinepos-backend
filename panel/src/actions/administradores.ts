'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { ejecutar, leerTexto, type EstadoAccion } from './comun';

function refrescar() {
  revalidatePath('/administradores');
}

/**
 * Alta de administrador (dueño del SaaS). La contraseña viaja al backend y se
 * guarda hasheada con bcrypt: el panel nunca la vuelve a ver.
 */
export async function crearAdministrador(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const resultado = await ejecutar('Administrador creado', () =>
    api.post('/api/administradores', {
      email: leerTexto(datos, 'email'),
      password: leerTexto(datos, 'password'),
      rol: leerTexto(datos, 'rol') ?? 'ADMINISTRADOR',
    })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function actualizarAdministrador(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const id = String(datos.get('id') ?? '');

  const resultado = await ejecutar('Administrador actualizado', () =>
    api.put(`/api/administradores/${id}`, {
      email: leerTexto(datos, 'email'),
      rol: leerTexto(datos, 'rol') ?? 'ADMINISTRADOR',
    })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function alternarActivoAdministrador(id: string, activo: boolean): Promise<EstadoAccion> {
  const resultado = await ejecutar(activo ? 'Administrador activado' : 'Administrador desactivado', () =>
    api.patch(`/api/administradores/${id}/activo`, { activo })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function resetearPasswordAdministrador(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const id = String(datos.get('id') ?? '');

  const resultado = await ejecutar('Contraseña actualizada', () =>
    api.post(`/api/administradores/${id}/reset-password`, {
      password: leerTexto(datos, 'password'),
    })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function eliminarAdministrador(id: string): Promise<EstadoAccion> {
  const resultado = await ejecutar('Administrador eliminado', () =>
    api.delete(`/api/administradores/${id}`)
  );

  if (resultado.ok) refrescar();
  return resultado;
}
