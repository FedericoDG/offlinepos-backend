import { cookies } from 'next/headers';
import type { Administrador } from './tipos';

export const NOMBRE_COOKIE = process.env.SESSION_COOKIE_NAME || 'binario_panel_session';

/**
 * La sesion es el JWT que emite el backend, guardado en una cookie httpOnly.
 * El panel no lo verifica: la firma la valida el backend en cada request. Aca
 * solo se lee el payload para saber a quien mostrar arriba a la derecha y para
 * no mandar a la API un token que ya sabemos vencido.
 */
export interface Sesion {
  token: string;
  administrador: Administrador;
  expira: Date | null;
}

function decodificarPayload(token: string): Record<string, unknown> | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;

  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const relleno = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(relleno, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export async function guardarSesion(token: string): Promise<void> {
  const payload = decodificarPayload(token);
  const expiraEn = typeof payload?.exp === 'number' ? new Date(payload.exp * 1000) : undefined;

  const almacen = await cookies();
  almacen.set(NOMBRE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(expiraEn && { expires: expiraEn }),
  });
}

export async function leerSesion(): Promise<Sesion | null> {
  const almacen = await cookies();
  const token = almacen.get(NOMBRE_COOKIE)?.value;
  if (!token) return null;

  const payload = decodificarPayload(token);
  if (!payload || typeof payload.email !== 'string') return null;

  const expira = typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null;
  if (expira && expira.getTime() <= Date.now()) return null;

  return {
    token,
    administrador: {
      id: String(payload.id ?? ''),
      email: payload.email,
      rol: String(payload.rol ?? 'ADMINISTRADOR'),
    },
    expira,
  };
}

export async function cerrarSesion(): Promise<void> {
  const almacen = await cookies();
  almacen.delete(NOMBRE_COOKIE);
}
