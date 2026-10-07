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

/** Fila del ABM de administradores: nunca trae la contraseña. */
export interface AdministradorListado {
  id: string;
  email: string;
  rol: string;
  activo: boolean;
  createdAt: string;
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
  /** Contacto opcional. Cadena vacía se guarda como null. */
  telefono?: string | null;
  email?: string | null;
  /** Plan asignado en directo (alta en un paso). */
  plan_id?: string | null;
  /**
   * Plan anidado liviano que ya trae el listado (`nombre` y `precio_mensual`).
   * `null` = comercio sin plan. Se conserva `plan_id` para cruzarlo con el
   * catálogo cuando hace falta el cupo de claves.
   */
  plan?: { id: string; nombre: string; precio_mensual: number; chat_mensajes_mes: number } | null;
  /** Cuántas claves del comercio están en estado activa. */
  claves_activas?: number;
  /** Períodos impagos estimados al momento de listar (0 = al día). */
  deuda_periodos?: number;
  chat_mensajes_override?: number | null;
  licencias: Licencia[];
  createdAt: string;
  updatedAt: string;
}

/* --------------------------------------------------------------------------
   Detalle de un comercio: todo lo de la pantalla `/comercios/[id]` en una
   sola respuesta de `GET /api/comercios/:id/detalle`.
   -------------------------------------------------------------------------- */

/** Plan tal como lo expone el detalle, con el cupo que necesita el panel. */
export interface ComercioDetallePlan {
  id: string;
  nombre: string;
  precio_mensual: number;
  precio_anual: number | null;
  max_servidores: number;
  max_clientes: number;
  chat_mensajes_mes: number;
}

/** Clave del comercio ya enmascarada: el detalle nunca devuelve la clave entera. */
export interface ComercioDetalleClave {
  id: string;
  rol: RolLicencia;
  estado: string;
  activaciones: number;
  ultima_activacion: string | null;
  clave_mascara: string | null;
}

export interface ComercioConsumoPorClave {
  clave_mascara: string | null;
  rol: RolLicencia;
  mensajes: number;
  tokens: number;
}

/** Consumo de chat del período en curso, con su cupo resuelto. */
export interface ComercioConsumoChat {
  periodo_actual: string;
  total_mensajes: number;
  total_tokens: number;
  /** 0 = ilimitado. */
  cupo: number;
  por_clave: ComercioConsumoPorClave[];
}

/** Pago directo del comercio, tal como lo devuelve el detalle. */
export interface ComercioPago {
  id: string;
  monto: number;
  moneda: string;
  metodo: MetodoPago;
  pagado_en: string;
  periodo_desde: string;
  periodo_hasta: string;
  nota: string | null;
}

/** Deuda estimada: el panel la muestra como estimación, nunca como exacta. */
export interface ComercioDeuda {
  al_dia: boolean;
  periodos_impagos: number;
  monto_estimado: number;
  desde: string;
  regla: string;
}

export interface ComercioDetalle {
  comercio: {
    id: string;
    nombre: string;
    telefono: string | null;
    email: string | null;
    createdAt: string;
  };
  plan: ComercioDetallePlan | null;
  claves: ComercioDetalleClave[];
  consumo_chat: ComercioConsumoChat;
  pagos: ComercioPago[];
  deuda: ComercioDeuda;
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
  /** `null` = clave libre, todavía sin asignar a un comercio. */
  comercio: { id: string; nombre: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** Clave libre recién generada, con su texto plano para entregar. */
export interface ClaveGenerada {
  id: string;
  clave: string;
  rol: RolLicencia;
  estado: string;
  max_activaciones: number;
}

/** Resumen de una clave que se asignó a un comercio en el alta. */
export interface ClaveAsignada {
  id: string;
  rol: RolLicencia;
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
  comercios_con_plan: number;
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
