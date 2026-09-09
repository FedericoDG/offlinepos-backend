/** Espejo de lo que devuelve el backend. Un solo lugar para mirar la forma. */

/** Envoltorio de todo lo que el backend pagina. */
export interface Paginado<T> {
  datos: T[];
  total: number;
  pagina: number;
  limite: number;
  paginas: number;
}

export type RolLicencia = 'SERVIDOR' | 'CLIENTE';
export type CicloFacturacion = 'MENSUAL' | 'ANUAL';
export type EstadoSuscripcion = 'ACTIVA' | 'EN_GRACIA' | 'VENCIDA' | 'CANCELADA';
export type MetodoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'MERCADO_PAGO' | 'TARJETA' | 'OTRO';

export interface Administrador {
  id: string;
  email: string;
  rol: string;
}

export interface Activacion {
  id: string;
  instalacion_id: string;
  ultima_validacion: string;
  createdAt: string;
  updatedAt: string;
}

export interface Licencia {
  id: string;
  clave_hash: string;
  clave_original: string | null;
  rol: RolLicencia;
  estado: string;
  max_activaciones: number;
  activado_en: string | null;
  activaciones: Activacion[];
  createdAt: string;
  updatedAt: string;
}

export interface Comercio {
  id: string;
  nombre: string;
  licencias: Licencia[];
  createdAt: string;
  updatedAt: string;
}

/** Licencia tal como la devuelve el listado paginado, con su comercio adentro. */
export interface LicenciaListada {
  id: string;
  clave_original: string | null;
  rol: RolLicencia;
  estado: string;
  max_activaciones: number;
  activado_en: string | null;
  activaciones: { id: string; instalacion_id: string; ultima_validacion: string }[];
  comercio: { id: string; nombre: string };
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  precio_mensual: number;
  precio_anual: number | null;
  moneda: string;
  max_servidores: number;
  max_clientes: number;
  chat_mensajes_mes: number;
  activo: boolean;
  suscripciones_activas: number;
  createdAt: string;
  updatedAt: string;
}

export interface PagoResumido {
  id: string;
  monto: number;
  moneda: string;
  metodo: MetodoPago;
  pagado_en: string;
  periodo_desde: string;
  periodo_hasta: string;
  referencia: string | null;
}

export interface LicenciaTocada {
  id: string;
  clave: string;
  rol: RolLicencia;
}

/** Que licencias movio la ultima operacion sobre la suscripcion. */
export interface AjusteLicencias {
  emitidas: LicenciaTocada[];
  reactivadas: LicenciaTocada[];
  suspendidas: LicenciaTocada[];
}

export interface Suscripcion {
  id: string;
  estado: EstadoSuscripcion;
  estado_efectivo: EstadoSuscripcion;
  dias_restantes: number;
  dias_gracia: number;
  ciclo: CicloFacturacion;
  precio_pactado: number;
  moneda: string;
  inicia_en: string;
  vence_en: string;
  cancelada_en: string | null;
  nota: string | null;
  comercio: { id: string; nombre: string };
  plan: { id: string; codigo: string; nombre: string; precio_mensual: number; precio_anual: number | null; max_servidores: number; max_clientes: number } | null;
  pagos: PagoResumido[];
  ajuste_licencias?: AjusteLicencias;
  createdAt: string;
  updatedAt: string;
}

export interface Pago extends PagoResumido {
  nota: string | null;
  suscripcion: {
    id: string;
    ciclo: CicloFacturacion;
    vence_en: string;
    comercio: { id: string; nombre: string };
    plan: { id: string; codigo: string; nombre: string } | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** La pagina de pagos suma ademas el total de todo lo filtrado, no solo lo visible. */
export interface PagosPaginados extends Paginado<Pago> {
  total_monto: number;
}

export interface IngresoMensual {
  periodo: string;
  etiqueta: string;
  total: number;
  cantidad_pagos: number;
}

export interface IngresoPorPlan {
  plan_id: string;
  codigo: string;
  nombre: string;
  total: number;
  cantidad: number;
}

export interface Vencimiento {
  id: string;
  comercio: { id: string; nombre: string };
  plan: { id: string; codigo: string; nombre: string } | null;
  ciclo: CicloFacturacion;
  precio_pactado: number;
  moneda: string;
  vence_en: string;
  dias_restantes: number;
  vencida: boolean;
  en_gracia: boolean;
  ultimo_pago: { pagado_en: string; monto: number } | null;
}

export interface Resumen {
  ingreso_mes: number;
  pagos_mes: number;
  ingreso_mes_anterior: number;
  variacion_mensual: number | null;
  mrr: number;
  suscripciones: {
    activas: number;
    en_gracia: number;
    vencidas: number;
    canceladas: number;
    total: number;
  };
  por_vencer_30_dias: number;
  comercios: number;
  licencias: number;
  activaciones: number;
  dias_gracia: number;
  generado_en: string;
}

export interface ChatConsumoDetalle {
  comercio_id: string;
  comercio: string;
  plan: string;
  mensajes_usados: number;
  mensajes_limite: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  costo_usd: number;
}

export interface ChatConsumoResponse {
  resumen: {
    total_mensajes: number;
    total_tokens: number;
    total_costo_usd: number;
    comercios_activos: number;
  };
  detalle: ChatConsumoDetalle[];
}

export interface ArchivoVersion {
  nombre: string;
  url: string;
  bytes: number;
}

export interface VersionPublicada {
  version: string;
  esVigente: boolean;
  archivos: ArchivoVersion[];
  bytes: number;
}

export interface VersionVigente {
  version: string | null;
  notas: string | null;
  pub_date: string | null;
  archivos: ArchivoVersion[];
  versiones: VersionPublicada[];
}
