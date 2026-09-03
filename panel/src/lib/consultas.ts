import { api } from './api';
import type {
  Comercio,
  IngresoMensual,
  IngresoPorPlan,
  LicenciaListada,
  Paginado,
  PagosPaginados,
  Plan,
  Resumen,
  Suscripcion,
  Vencimiento,
} from './tipos';

/** Arma un query string salteando lo vacio, para no ensuciar la URL. */
function query(params: Record<string, string | number | undefined>): string {
  const busqueda = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== '') busqueda.set(clave, String(valor));
  }
  const cadena = busqueda.toString();
  return cadena ? `?${cadena}` : '';
}

/**
 * Lecturas del backend. Se llaman desde server components, con el token de la
 * cookie: nunca desde el navegador.
 */

export const consultas = {
  resumen: () => api.get<Resumen>('/api/estadisticas/resumen'),

  ingresosMensuales: (meses = 12) =>
    api.get<IngresoMensual[]>(`/api/estadisticas/ingresos-mensuales?meses=${meses}`),

  ingresosPorPlan: (meses = 12) => api.get<IngresoPorPlan[]>(`/api/estadisticas/ingresos-por-plan?meses=${meses}`),

  proximosVencimientos: (dias = 30) =>
    api.get<Vencimiento[]>(`/api/estadisticas/proximos-vencimientos?dias=${dias}`),

  planes: (soloActivos = false) => api.get<Plan[]>(`/api/planes${soloActivos ? '?activos=true' : ''}`),

  comercios: () => api.get<Comercio[]>('/api/comercios'),

  suscripciones: (filtros: { comercio_id?: string; estado?: string; vence_en_dias?: number } = {}) => {
    const query = new URLSearchParams();
    if (filtros.comercio_id) query.set('comercio_id', filtros.comercio_id);
    if (filtros.estado) query.set('estado', filtros.estado);
    if (filtros.vence_en_dias !== undefined) query.set('vence_en_dias', String(filtros.vence_en_dias));
    const cadena = query.toString();
    return api.get<Suscripcion[]>(`/api/suscripciones${cadena ? `?${cadena}` : ''}`);
  },

  /** Listado paginado de licencias. `q` busca por nombre de comercio. */
  licencias: (filtros: { q?: string; comercio_id?: string; rol?: string; estado?: string; pagina?: number; limite?: number } = {}) =>
    api.get<Paginado<LicenciaListada>>(`/api/licencias${query({ ...filtros })}`),

  pagos: (filtros: { q?: string; comercio_id?: string; desde?: string; hasta?: string; pagina?: number; limite?: number } = {}) =>
    api.get<PagosPaginados>(`/api/pagos${query({ ...filtros })}`),
};
