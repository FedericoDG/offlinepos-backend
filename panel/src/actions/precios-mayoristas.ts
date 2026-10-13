'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { ejecutar, type EstadoAccion } from './comun';
import type { ReporteImportacionMayorista } from '@/lib/tipos';

/**
 * Importa un dump de SEPA desde el panel.
 *
 * El dueño sube el ZIP que publica cada mayorista (los tres CSV:
 * `comercio.csv`, `sucursales.csv` y `productos.csv`). El archivo viaja tal
 * cual al backend, que lo descomprime, valida el formato y hace el upsert.
 */
export async function importarDumpMayorista(
  _estado: EstadoAccion,
  datos: FormData,
): Promise<EstadoAccion> {
  const archivo = datos.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { ok: false, error: 'Elegí el archivo .zip que publica el mayorista' };
  }
  if (!archivo.name.toLowerCase().endsWith('.zip')) {
    return { ok: false, error: 'El archivo tiene que ser un .zip con los tres CSV de SEPA' };
  }

  const reenvio = new FormData();
  reenvio.set('archivo', archivo, archivo.name);

  const resultado = await ejecutar(
    (reporte: ReporteImportacionMayorista) => {
      const cadenas = reporte.cadenas ?? [];
      if (cadenas.length === 0) return 'El ZIP no traía ningún comercio para importar';

      const segundos = `${(reporte.ms / 1000).toFixed(1)} s`;
      const totalProductos = cadenas.reduce((suma, c) => suma + c.productos.total, 0);

      // Un lote: se resumen todos los comercios y, si alguno falló, se avisa.
      if (cadenas.length > 1 || (reporte.archivos ?? 0) > 1) {
        const omitidos = reporte.omitidos?.length
          ? ` · ${reporte.omitidos.length} sin importar`
          : '';
        return `${cadenas.length} comercios: ${totalProductos.toLocaleString('es-AR')} productos en ${segundos}${omitidos}`;
      }

      const { total, creados, actualizados } = cadenas[0].productos;
      return `${cadenas[0].bandera_nombre}: ${total.toLocaleString('es-AR')} productos (${creados} nuevos, ${actualizados} actualizados) en ${segundos}`;
    },
    () => api.subir<ReporteImportacionMayorista>('/api/precios-mayoristas/importar', reenvio),
  );

  if (resultado.ok) revalidatePath('/precios-mayoristas');

  return resultado;
}

/** Borra una cadena completa: sus precios y sucursales caen en cascada. */
export async function eliminarCadena(id: string): Promise<EstadoAccion> {
  const resultado = await ejecutar(
    (r: { message?: string }) => r.message ?? 'Cadena borrada',
    () => api.delete(`/api/precios-mayoristas/${encodeURIComponent(id)}`),
  );

  if (resultado.ok) revalidatePath('/precios-mayoristas');

  return resultado;
}

/** Borra TODAS las cadenas cargadas: vacía la sección para empezar de nuevo. */
export async function vaciarCadenas(): Promise<EstadoAccion> {
  const resultado = await ejecutar(
    (r: { message?: string }) => r.message ?? 'Se borraron todas las cadenas',
    () => api.delete('/api/precios-mayoristas'),
  );

  if (resultado.ok) revalidatePath('/precios-mayoristas');

  return resultado;
}
