'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { ejecutar, leerNumero, leerTexto, type EstadoAccion } from './comun';
import type { AjusteLicencias, Suscripcion } from '@/lib/tipos';

/**
 * Traduce a una frase lo que la operación le hizo a las licencias del
 * comercio. Es la mitad importante del aviso: quien contrata un plan necesita
 * saber que además le acaban de salir tres claves para entregar.
 */
function resumirAjuste(base: string, resultado: Suscripcion): string {
  const ajuste: AjusteLicencias | undefined = resultado?.ajuste_licencias;
  if (!ajuste) return base;

  const partes: string[] = [];
  const nuevas = ajuste.emitidas.length + ajuste.reactivadas.length;


  if (nuevas > 0) partes.push(`${nuevas} ${nuevas === 1 ? 'licencia disponible' : 'licencias disponibles'}`);
  if (ajuste.suspendidas.length > 0) {
    partes.push(
      `${ajuste.suspendidas.length} ${ajuste.suspendidas.length === 1 ? 'suspendida' : 'suspendidas'} por el cupo del plan`
    );
  }

  if (partes.length === 0) return base;
  return `${base}. ${partes.join(' y ')}. Las ves en Licencias.`;
}

function refrescar() {
  revalidatePath('/suscripciones');
  revalidatePath('/dashboard');
  revalidatePath('/comercios');
  // Contratar o cambiar de plan emite o suspende licencias: la pantalla de
  // Licencias queda vieja si no se invalida tambien.
  revalidatePath('/licencias');
}

export async function crearSuscripcion(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const resultado = await ejecutar((r: Suscripcion) => resumirAjuste('Contratada y primer pago registrado', r), () =>
    api.post('/api/suscripciones', {
      comercio_id: leerTexto(datos, 'comercio_id'),
      plan_id: leerTexto(datos, 'plan_id'),
      ciclo: (leerTexto(datos, 'ciclo') ?? 'MENSUAL') as 'MENSUAL' | 'ANUAL',
      ...(leerNumero(datos, 'precio_pactado') !== undefined && {
        precio_pactado: leerNumero(datos, 'precio_pactado'),
      }),
      ...(leerTexto(datos, 'inicia_en') && { inicia_en: leerTexto(datos, 'inicia_en') }),
      ...(leerTexto(datos, 'vence_en') && { vence_en: leerTexto(datos, 'vence_en') }),
      ...(leerTexto(datos, 'nota') && { nota: leerTexto(datos, 'nota') }),
      // Contratar implica que el comercio pagó: el backend asienta el primer
      // pago solo. Esto es para decir cómo entró, no si entró.
      metodo_pago: leerTexto(datos, 'metodo_pago') ?? 'TRANSFERENCIA',
      ...(leerTexto(datos, 'referencia_pago') && { referencia_pago: leerTexto(datos, 'referencia_pago') }),
      ...(leerTexto(datos, 'pagado_en') && { pagado_en: leerTexto(datos, 'pagado_en') }),
    })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function actualizarSuscripcion(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const id = String(datos.get('id') ?? '');

  const resultado = await ejecutar((r: Suscripcion) => resumirAjuste('Suscripción actualizada', r), () =>
    api.put(`/api/suscripciones/${id}`, {
      plan_id: leerTexto(datos, 'plan_id'),
      ciclo: leerTexto(datos, 'ciclo') as 'MENSUAL' | 'ANUAL' | undefined,
      precio_pactado: leerNumero(datos, 'precio_pactado'),
      ...(leerTexto(datos, 'vence_en') && { vence_en: leerTexto(datos, 'vence_en') }),
      nota: leerTexto(datos, 'nota') ?? null,
    })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

/**
 * Renovar corre el vencimiento un periodo. Con "cobrado" tildado el backend
 * ademas deja el pago asentado en la misma transaccion, que es el 90% de los
 * casos: se renueva porque el comercio pago.
 */
export async function renovarSuscripcion(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const id = String(datos.get('id') ?? '');
  const registrarPago = datos.get('registrar_pago') === 'on';

  const resultado = await ejecutar(registrarPago ? 'Renovada y pago registrado' : 'Suscripción renovada', () =>
    api.post(`/api/suscripciones/${id}/renovar`, {
      periodos: leerNumero(datos, 'periodos') ?? 1,
      registrar_pago: registrarPago,
      ...(leerNumero(datos, 'monto') !== undefined && { monto: leerNumero(datos, 'monto') }),
      metodo: (leerTexto(datos, 'metodo') ?? 'TRANSFERENCIA') as string,
      ...(leerTexto(datos, 'pagado_en') && { pagado_en: leerTexto(datos, 'pagado_en') }),
      ...(leerTexto(datos, 'referencia') && { referencia: leerTexto(datos, 'referencia') }),
    })
  );

  if (resultado.ok) {
    refrescar();
    revalidatePath('/pagos');
  }
  return resultado;
}

export async function cancelarSuscripcion(id: string): Promise<EstadoAccion> {
  const resultado = await ejecutar('Suscripción cancelada', () => api.post(`/api/suscripciones/${id}/cancelar`));
  if (resultado.ok) refrescar();
  return resultado;
}

export async function reactivarSuscripcion(id: string): Promise<EstadoAccion> {
  const resultado = await ejecutar('Suscripción reactivada', () =>
    api.put(`/api/suscripciones/${id}`, { estado: 'ACTIVA' })
  );
  if (resultado.ok) refrescar();
  return resultado;
}
