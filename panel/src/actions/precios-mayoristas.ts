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
      const cadena = reporte.cadenas?.[0];
      if (!cadena) return 'El ZIP no traía ninguna bandera para importar';
      const { total, creados, actualizados } = cadena.productos;
      return `${cadena.bandera_nombre}: ${total} productos (${creados} nuevos, ${actualizados} actualizados) en ${(reporte.ms / 1000).toFixed(1)} s`;
    },
    () => api.subir<ReporteImportacionMayorista>('/api/precios-mayoristas/importar', reenvio),
  );

  if (resultado.ok) revalidatePath('/precios-mayoristas');

  return resultado;
}
