'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { api, esRedireccion, mensajeDeError } from '@/lib/api';
import { cerrarSesion, guardarSesion } from '@/lib/sesion';
import type { Administrador } from '@/lib/tipos';

export interface EstadoLogin {
  error?: string;
  email?: string;
}

const CredencialesDTO = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Escribí tu email').email('Ese email no tiene formato válido'),
  password: z.string().min(1, 'Escribí tu contraseña'),
});

interface RespuestaLogin {
  token: string;
  administrador: Administrador;
}

export async function iniciarSesion(_estado: EstadoLogin, datos: FormData): Promise<EstadoLogin> {
  const email = String(datos.get('email') ?? '');
  const volver = String(datos.get('volver') ?? '');

  const validacion = CredencialesDTO.safeParse({ email, password: datos.get('password') });
  if (!validacion.success) {
    return { error: validacion.error.issues[0]?.message ?? 'Revisa los datos', email };
  }

  try {
    const respuesta = await api.publico.post<RespuestaLogin>('/api/administradores/login', validacion.data);
    await guardarSesion(respuesta.token);
  } catch (error) {
    if (esRedireccion(error)) throw error;
    return { error: mensajeDeError(error), email };
  }

  // Fuera del try: `redirect` funciona lanzando, y atraparlo cancelaria el salto.
  redirect(volver && volver.startsWith('/') ? volver : '/dashboard');
}

export async function salir(): Promise<void> {
  await cerrarSesion();
  redirect('/login');
}
