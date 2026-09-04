import { esRedireccion, mensajeDeError } from '@/lib/api';

/** Forma unica de respuesta de las server actions, para que los formularios
 *  del panel tengan un solo contrato que leer. */
export interface EstadoAccion {
  ok?: boolean;
  error?: string;
  mensaje?: string;
}

export const VACIO: EstadoAccion = {};

/**
 * Envuelve una mutacion: devuelve el estado listo para `useActionState` y deja
 * pasar las redirecciones de Next, que viajan como excepcion.
 */
export async function ejecutar(
  mensaje: string | ((resultado: any) => string),
  operacion: () => Promise<unknown>
): Promise<EstadoAccion> {
  try {
    const resultado = await operacion();
    return { ok: true, mensaje: typeof mensaje === 'function' ? mensaje(resultado) : mensaje };
  } catch (error) {
    if (esRedireccion(error)) throw error;
    return { ok: false, error: mensajeDeError(error) };
  }
}

/** Lee un número de un FormData tolerando coma decimal y separadores de miles. */
export function leerNumero(datos: FormData, campo: string): number | undefined {
  const bruto = datos.get(campo);
  if (bruto === null || String(bruto).trim() === '') return undefined;
  const limpio = String(bruto).replace(/\./g, '').replace(',', '.');
  const valor = Number(limpio);
  return Number.isFinite(valor) ? valor : undefined;
}

export function leerTexto(datos: FormData, campo: string): string | undefined {
  const bruto = datos.get(campo);
  if (bruto === null) return undefined;
  const texto = String(bruto).trim();
  return texto === '' ? undefined : texto;
}
