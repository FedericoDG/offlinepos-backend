'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { ejecutar, leerNumero, leerTexto, type EstadoAccion } from './comun';

function refrescar() {
  revalidatePath('/planes');
  revalidatePath('/dashboard');
  revalidatePath('/suscripciones');
}

export async function crearPlan(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const resultado = await ejecutar('Plan creado', () =>
    api.post('/api/planes', {
      codigo: leerTexto(datos, 'codigo'),
      nombre: leerTexto(datos, 'nombre'),
      descripcion: leerTexto(datos, 'descripcion'),
      precio_mensual: leerNumero(datos, 'precio_mensual') ?? 0,
      precio_anual: leerNumero(datos, 'precio_anual') ?? null,
      max_servidores: leerNumero(datos, 'max_servidores') ?? 1,
      max_clientes: leerNumero(datos, 'max_clientes') ?? 0,
      chat_mensajes_mes: leerNumero(datos, 'chat_mensajes_mes') ?? 500,
      activo: datos.get('activo') === 'on',
    })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function actualizarPlan(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const id = String(datos.get('id') ?? '');

  const resultado = await ejecutar('Plan actualizado', () =>
    api.put(`/api/planes/${id}`, {
      nombre: leerTexto(datos, 'nombre'),
      descripcion: leerTexto(datos, 'descripcion') ?? null,
      precio_mensual: leerNumero(datos, 'precio_mensual') ?? 0,
      precio_anual: leerNumero(datos, 'precio_anual') ?? null,
      max_servidores: leerNumero(datos, 'max_servidores') ?? 1,
      max_clientes: leerNumero(datos, 'max_clientes') ?? 0,
      chat_mensajes_mes: leerNumero(datos, 'chat_mensajes_mes') ?? 500,
      activo: datos.get('activo') === 'on',
    })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function alternarPlan(id: string, activo: boolean): Promise<EstadoAccion> {
  const resultado = await ejecutar(activo ? 'Plan reactivado' : 'Plan desactivado', () =>
    api.put(`/api/planes/${id}`, { activo })
  );

  if (resultado.ok) refrescar();
  return resultado;
}
