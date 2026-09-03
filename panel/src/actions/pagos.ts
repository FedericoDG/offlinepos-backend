'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { ejecutar, leerNumero, leerTexto, type EstadoAccion } from './comun';

function refrescar() {
  revalidatePath('/pagos');
  revalidatePath('/dashboard');
  revalidatePath('/suscripciones');
}

export async function registrarPago(_estado: EstadoAccion, datos: FormData): Promise<EstadoAccion> {
  const resultado = await ejecutar('Pago registrado', () =>
    api.post('/api/pagos', {
      suscripcion_id: leerTexto(datos, 'suscripcion_id'),
      monto: leerNumero(datos, 'monto') ?? 0,
      metodo: (leerTexto(datos, 'metodo') ?? 'TRANSFERENCIA') as string,
      ...(leerTexto(datos, 'pagado_en') && { pagado_en: leerTexto(datos, 'pagado_en') }),
      periodo_desde: leerTexto(datos, 'periodo_desde'),
      periodo_hasta: leerTexto(datos, 'periodo_hasta'),
      ...(leerTexto(datos, 'referencia') && { referencia: leerTexto(datos, 'referencia') }),
      ...(leerTexto(datos, 'nota') && { nota: leerTexto(datos, 'nota') }),
    })
  );

  if (resultado.ok) refrescar();
  return resultado;
}

export async function eliminarPago(id: string): Promise<EstadoAccion> {
  const resultado = await ejecutar('Pago eliminado', () => api.delete(`/api/pagos/${id}`));
  if (resultado.ok) refrescar();
  return resultado;
}
