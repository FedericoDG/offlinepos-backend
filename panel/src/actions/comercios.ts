'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { ejecutar, leerTexto, type EstadoAccion } from './comun';

function refrescar() {
  revalidatePath('/comercios');
  revalidatePath('/licencias');
  revalidatePath('/suscripciones');
  revalidatePath('/dashboard');
}

/**
 * Alta en dos pasos: el comercio nace vacío, sin licencias y sin plan. Las
 * licencias las emite después la suscripción, según el cupo del plan que se
 * contrate. Así no hay forma de terminar con claves sueltas que ningún
 * contrato respalda.
 */
export async function crearComercio(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const resultado = await ejecutar('Comercio creado. Ahora contratale un plan desde Suscripciones.', () =>
    api.post('/api/comercios', { nombre: leerTexto(datos, 'nombre') })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function renombrarComercio(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const id = String(datos.get('id') ?? '');

  const resultado = await ejecutar('Comercio actualizado', () =>
    api.put(`/api/comercios/${id}`, { nombre: leerTexto(datos, 'nombre') })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function ajustarCupoBinny(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const id = String(datos.get('id') ?? '');
  const raw = String(datos.get('chat_mensajes_override') ?? '').trim();
  const payload: Record<string, unknown> = {};
  if (raw === '') {
    payload.chat_mensajes_override = null;
  } else {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return { ok: false, mensaje: 'El cupo debe ser un entero >= 0 (0 = ilimitado, vacío = usa plan)' };
    payload.chat_mensajes_override = n;
  }

  const resultado = await ejecutar('Cupo de Binny actualizado', () => api.put(`/api/comercios/${id}`, payload));

  if (resultado.ok) refrescar();
  return resultado;
}

export async function eliminarComercio(id: string): Promise<EstadoAccion> {
  const resultado = await ejecutar('Comercio eliminado', () => api.delete(`/api/comercios/${id}`));
  if (resultado.ok) refrescar();
  return resultado;
}
