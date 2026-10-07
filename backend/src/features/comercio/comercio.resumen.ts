/**
 * Helpers puros del resumen de un comercio: mascara de claves, deuda estimada
 * y periodos de facturacion.
 *
 * Viven aparte del service porque no tocan la base: son cuentas que conviene
 * poder mirar (y ejercitar) sin Postgres de por medio.
 */

/** Regla que se muestra junto a la deuda para que el panel no la presente como exacta. */
export const REGLA_DEUDA =
  'estimada: meses transcurridos desde el último periodo cubierto (o alta) vs ciclo mensual del plan';

export interface DeudaEstimada {
  al_dia: boolean;
  periodos_impagos: number;
  monto_estimado: number;
  desde: Date;
  regla: string;
}

/**
 * Cuenta de meses calendario entre dos fechas (diferencia de año/mes, sin mirar
 * el dia). Es la cuenta que le sirve a la facturacion: un periodo que termina el
 * 30 de septiembre deja octubre sin cubrir desde el 1 de octubre.
 */
export function mesesEntre(desde: Date, hasta: Date): number {
  const meses = (hasta.getFullYear() - desde.getFullYear()) * 12 + (hasta.getMonth() - desde.getMonth());
  return Math.max(0, meses);
}

/**
 * Deuda estimada de un comercio. El ancla es el fin del ultimo periodo cubierto
 * por un pago; si nunca pago, el alta. Sin plan no hay ciclo que estimar: se
 * devuelve al dia y monto 0 para no inventar una deuda.
 */
export function calcularDeuda(
  plan: { precio_mensual: unknown } | null,
  alta: Date,
  ultimoPeriodoCubierto: Date | null,
  ahora: Date = new Date()
): DeudaEstimada {
  const desde = ultimoPeriodoCubierto ?? alta;

  if (!plan) {
    return { al_dia: true, periodos_impagos: 0, monto_estimado: 0, desde, regla: REGLA_DEUDA };
  }

  const periodos = mesesEntre(desde, ahora);

  return {
    al_dia: periodos === 0,
    periodos_impagos: periodos,
    monto_estimado: periodos * Number(plan.precio_mensual),
    desde,
    regla: REGLA_DEUDA,
  };
}

/**
 * Muestra solo el primer grupo de la clave (`ABCD-••••-••••`). El resto se tapa
 * para poder listar claves sin exponerlas enteras en una pantalla.
 */
export function mascaraClave(clave: string | null): string | null {
  if (!clave) return null;

  const partes = clave.split('-');
  if (partes.length <= 1) return '••••';

  return [partes[0], ...partes.slice(1).map((parte) => '•'.repeat(parte.length))].join('-');
}

/** Periodo en formato "YYYY-MM", igual que `ChatConsumo.periodo`. */
export function periodoActual(ahora: Date = new Date()): string {
  return ahora.toISOString().slice(0, 7);
}

/** Primer dia del mes de `fecha`, en UTC (coherente con como se guardan los periodos). */
export function inicioDeMes(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1));
}

/** Ultimo dia del mes de `fecha`, en UTC. */
export function finDeMes(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}
