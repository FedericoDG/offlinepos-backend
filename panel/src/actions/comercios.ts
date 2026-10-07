'use server';

import { revalidatePath } from 'next/cache';
import { api, esRedireccion, mensajeDeError } from '@/lib/api';
import { ejecutar, leerNumero, leerTexto, type EstadoAccion } from './comun';
import type { ClaveAsignada } from '@/lib/tipos';

function refrescar(comercioId?: string) {
  revalidatePath('/comercios');
  revalidatePath('/licencias');
  revalidatePath('/dashboard');
  // La pantalla de detalle vive en una ruta dinámica: hay que nombrarla aparte.
  if (comercioId) revalidatePath(`/comercios/${comercioId}`);
}

/**
 * Alta simple de un comercio que nace vacío, sin licencias y sin plan.
 * El camino normal es `crearComercioConClaves`: comercio, plan y claves libres
 * asignadas en un paso. Este queda para dar el nombre antes de decidir el plan.
 */
export async function crearComercio(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const resultado = await ejecutar('Comercio creado. Sin plan asignado no puede emitir licencias.', () =>
    api.post('/api/comercios', {
      nombre: leerTexto(datos, 'nombre'),
      telefono: leerTexto(datos, 'telefono') ?? null,
      email: leerTexto(datos, 'email') ?? null,
    })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

/**
 * Edita los datos de contacto de un comercio. Manda siempre los tres campos:
 * `null` explícito para teléfono/email vacíos, porque si se omitieran el
 * backend no podría distinguir "no lo toques" de "bórralo".
 */
export async function editarComercio(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const id = String(datos.get('id') ?? '');

  const resultado = await ejecutar('Comercio actualizado', () =>
    api.put(`/api/comercios/${id}`, {
      nombre: leerTexto(datos, 'nombre'),
      telefono: leerTexto(datos, 'telefono') ?? null,
      email: leerTexto(datos, 'email') ?? null,
    })
  );

  if (resultado.ok) refrescar(id);
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

/**
 * Pago directo del comercio, sin suscripción de por medio. El monto lo manda
 * el panel (prellenado con el precio del plan, pero editable: un pago parcial
 * también es un pago). El período, si se omite, cubre el mes en curso.
 */
export async function registrarPagoComercio(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const comercioId = String(datos.get('comercio_id') ?? '');
  const monto = leerNumero(datos, 'monto');

  if (monto === undefined || monto <= 0) {
    return { ok: false, error: 'El monto tiene que ser mayor a 0' };
  }

  const payload: Record<string, unknown> = {
    monto,
    metodo: leerTexto(datos, 'metodo') ?? 'TRANSFERENCIA',
    nota: leerTexto(datos, 'nota') ?? null,
  };

  // Las fechas van solo si tienen valor: `z.coerce.date()` rechaza la cadena vacía.
  const pagadoEn = leerTexto(datos, 'pagado_en');
  const periodoDesde = leerTexto(datos, 'periodo_desde');
  const periodoHasta = leerTexto(datos, 'periodo_hasta');
  if (pagadoEn) payload.pagado_en = pagadoEn;
  if (periodoDesde) payload.periodo_desde = periodoDesde;
  if (periodoHasta) payload.periodo_hasta = periodoHasta;

  const resultado = await ejecutar('Pago registrado', () =>
    api.post(`/api/comercios/${comercioId}/pagos`, payload)
  );

  if (resultado.ok) refrescar(comercioId);
  return resultado;
}

/**
 * Borra un pago. Los pagos viejos cuelgan de una suscripción y el backend los
 * rechaza con 409: ese mensaje llega tal cual al toast.
 */
export async function eliminarPago(pagoId: string, comercioId: string): Promise<EstadoAccion> {
  const resultado = await ejecutar('Pago eliminado', () => api.delete(`/api/pagos/${pagoId}`));
  if (resultado.ok) refrescar(comercioId);
  return resultado;
}

/** Respuesta del backend para el alta de un comercio con plan y claves. */
export interface CrearComercioConClavesEstado extends EstadoAccion {
  comercio?: { id: string; nombre: string; plan_id: string | null };
  licencias_asignadas?: ClaveAsignada[];
}

/**
 * Alta en un paso: crea el comercio, le asigna un plan y le asigna las claves
 * libres elegidas. No usa `ejecutar` porque tiene que devolver el comercio y
 * las claves asignadas para que el formulario confirme qué quedó asociado.
 */
export async function crearComercioConClaves(
  _estado: CrearComercioConClavesEstado,
  datos: FormData
): Promise<CrearComercioConClavesEstado> {
  const licencia_ids = datos
    .getAll('licencia_ids')
    .map((valor) => String(valor))
    .filter(Boolean);

  try {
    const respuesta = await api.post<{
      id: string;
      nombre: string;
      plan_id: string | null;
      licencias_asignadas: ClaveAsignada[];
    }>('/api/comercios', {
      nombre: leerTexto(datos, 'nombre'),
      plan_id: leerTexto(datos, 'plan_id'),
      licencia_ids,
      telefono: leerTexto(datos, 'telefono') ?? null,
      email: leerTexto(datos, 'email') ?? null,
    });

    refrescar();

    const cantidad = respuesta.licencias_asignadas?.length ?? 0;
    return {
      ok: true,
      mensaje:
        cantidad === 0
          ? 'Comercio creado con su plan. No le asignaste claves todavía.'
          : `Comercio creado con ${cantidad} ${cantidad === 1 ? 'clave asignada' : 'claves asignadas'}.`,
      comercio: { id: respuesta.id, nombre: respuesta.nombre, plan_id: respuesta.plan_id },
      licencias_asignadas: respuesta.licencias_asignadas,
    };
  } catch (error) {
    if (esRedireccion(error)) throw error;
    return { ok: false, error: mensajeDeError(error) };
  }
}
