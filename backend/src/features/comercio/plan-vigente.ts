/**
 * El plan vigente de un comercio, en un solo lugar.
 *
 * Estaba escrito tres veces (chat.service, comercio.service y
 * estadistica.service) y las tres versiones NO coincidían: una aceptaba
 * cualquier suscripción no cancelada y las otras sólo la activa. Ese detalle
 * es el que hizo que el consumo del chat mostrara "Sin plan": el alta nueva
 * asigna el plan DIRECTO (Comercio.plan_id) y el detalle sólo miraba la
 * suscripción, que está vacía.
 *
 * Este módulo no importa servicios: sólo env y tipos, así que no puede crear
 * ciclos entre features.
 */
import { env } from '../../config/env';

/** Lo mínimo que se lee de un plan. Permisivo a propósito: los llamadores
 *  pasan desde filas de Prisma hasta objetos armados a mano. */
export interface PlanDeComercio {
  id?: string;
  nombre?: string;
  moneda?: string;
  chat_mensajes_mes?: number;
  /**
   * El resto de los campos tal como los devuelve cada consulta: Prisma entrega
   * los precios como `Decimal`, y tiparlos acá como `number` hace que ninguna
   * fila real encaje. Los llama quien los lee.
   */
  [campo: string]: unknown;
}

/** Comercio con lo necesario para resolver su plan y su cupo de chat. */
export interface ComercioConPlan {
  chat_mensajes_override?: number | null;
  plan?: PlanDeComercio | null;
  suscripciones?: Array<{ estado?: string | null; plan?: PlanDeComercio | null }>;
}

/**
 * Plan vigente: el asignado DIRECTO al comercio (así se da de alta hoy) y, si
 * no tiene, el de su primera suscripción no cancelada (modelo viejo).
 *
 * Los llamadores que consultan con `estado: ACTIVA` y orden por fecha
 * descendente reciben un arreglo de un elemento, así que el primero es el
 * correcto.
 */
export function planVigente(comercio: ComercioConPlan | null | undefined): PlanDeComercio | null {
  if (!comercio) return null;
  const deSuscripcion =
    (comercio.suscripciones ?? []).find((suscripcion) => suscripcion.estado !== 'CANCELADA')?.plan ?? null;
  return comercio.plan ?? deSuscripcion ?? null;
}

/**
 * Cupo mensual de mensajes del chat. El override del comercio gana sobre todo
 * (0 = ilimitado); si no hay plan, cae al valor del entorno.
 */
export function cupoMensajesChat(comercio: ComercioConPlan | null | undefined): number {
  const override = comercio?.chat_mensajes_override;
  if (override != null) return override;
  return planVigente(comercio)?.chat_mensajes_mes ?? env.CHAT_MENSAJES_MES;
}
