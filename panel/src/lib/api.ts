import { redirect } from 'next/navigation';
import { leerSesion } from './sesion';

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');

export interface ErrorCampo {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly campos: ErrorCampo[] = []
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Cliente del backend. Corre siempre del lado del servidor de Next: el token
 * vive en una cookie httpOnly y nunca viaja al navegador, y de paso el backend
 * no necesita tener al panel en CORS_ORIGIN.
 */
async function pedir<T>(ruta: string, init: RequestInit = {}, conToken = true): Promise<T> {
  let cabeceras: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };

  if (conToken) {
    const sesion = await leerSesion();
    if (!sesion) redirect('/login');
    cabeceras = { ...cabeceras, Authorization: `Bearer ${sesion.token}` };
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${BACKEND_URL}${ruta}`, {
      ...init,
      headers: cabeceras,
      // El panel muestra plata y vencimientos: una respuesta cacheada es una
      // decision tomada con datos viejos.
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      `No se pudo conectar con el backend en ${BACKEND_URL}. Verifica que este corriendo (npm run dev).`,
      503
    );
  }

  // Solo en las llamadas con token: ahi un 401 significa que la sesion se cayo
  // y no tiene sentido reintentar. En el login, en cambio, un 401 es
  // "contrasena incorrecta" y tiene que llegar como mensaje al formulario:
  // redirigir ahi le mostraria "tu sesion vencio" a alguien que recien se
  // esta equivocando de contrasena.
  if (respuesta.status === 401 && conToken) {
    redirect('/login?vencida=1');
  }

  const texto = await respuesta.text();
  const cuerpo = texto ? safeJson(texto) : null;

  if (!respuesta.ok) {
    throw new ApiError(
      (cuerpo as { message?: string })?.message || `El backend respondio ${respuesta.status}`,
      respuesta.status,
      ((cuerpo as { errors?: ErrorCampo[] })?.errors ?? []) as ErrorCampo[]
    );
  }

  return cuerpo as T;
}

function safeJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return { message: texto };
  }
}

export const api = {
  get: <T>(ruta: string) => pedir<T>(ruta, { method: 'GET' }),
  post: <T>(ruta: string, cuerpo?: unknown) =>
    pedir<T>(ruta, { method: 'POST', body: JSON.stringify(cuerpo ?? {}) }),
  put: <T>(ruta: string, cuerpo?: unknown) =>
    pedir<T>(ruta, { method: 'PUT', body: JSON.stringify(cuerpo ?? {}) }),
  patch: <T>(ruta: string, cuerpo?: unknown) =>
    pedir<T>(ruta, { method: 'PATCH', body: JSON.stringify(cuerpo ?? {}) }),
  delete: <T>(ruta: string) => pedir<T>(ruta, { method: 'DELETE' }),
  /** Sin token: el unico endpoint publico que usa el panel es el login. */
  publico: {
    post: <T>(ruta: string, cuerpo?: unknown) =>
      pedir<T>(ruta, { method: 'POST', body: JSON.stringify(cuerpo ?? {}) }, false),
  },
};

export function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.campos.length > 0) {
      return error.campos.map((c) => c.message).join('. ');
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Ocurrio un error inesperado';
}

/**
 * `redirect()` de Next funciona lanzando un error especial. Si una server
 * action envuelve la llamada en try/catch, ese error queda atrapado y la
 * redireccion nunca ocurre: hay que reconocerlo y volver a lanzarlo.
 */
export function esRedireccion(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}
