import { api } from './api';
import type {
  AdministradorListado,
  ChatConsumoResponse,
  Comercio,
  ComercioDetalle,
  LicenciaListada,
  Paginado,
  Plan,
  Suscripcion,
  VersionVigente,
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
  planes: (soloActivos = false) => api.get<Plan[]>(`/api/planes${soloActivos ? '?activos=true' : ''}`),

  comercios: () => api.get<Comercio[]>('/api/comercios'),

  /** Todo lo de la pantalla de detalle en una sola vuelta. */
  comercioDetalle: (id: string) => api.get<ComercioDetalle>(`/api/comercios/${id}/detalle`),

  administradores: () => api.get<AdministradorListado[]>('/api/administradores'),

  suscripciones: (filtros: { comercio_id?: string; estado?: string; vence_en_dias?: number } = {}) => {
    const query = new URLSearchParams();
    if (filtros.comercio_id) query.set('comercio_id', filtros.comercio_id);
    if (filtros.estado) query.set('estado', filtros.estado);
    if (filtros.vence_en_dias !== undefined) query.set('vence_en_dias', String(filtros.vence_en_dias));
    const cadena = query.toString();
    return api.get<Suscripcion[]>(`/api/suscripciones${cadena ? `?${cadena}` : ''}`);
  },

  /** Listado paginado de licencias. `q` busca por nombre de comercio; `libres=1` trae solo las claves sin asignar. */
  licencias: (filtros: { q?: string; comercio_id?: string; rol?: string; estado?: string; libres?: 1; pagina?: number; limite?: number } = {}) =>
    api.get<Paginado<LicenciaListada>>(`/api/licencias${query({ ...filtros })}`),

  chatConsumo: (periodo?: string) =>
    api.get<ChatConsumoResponse>(`/api/estadisticas/chat-consumo${periodo ? `?periodo=${periodo}` : ''}`),

  /** Versión del POS vigente publicada (lo que descargan los updater). */
  actualizacionVigente: () => api.get<VersionVigente>('/api/updates/admin/actual'),
};
