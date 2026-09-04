/**
 * Reglas del ciclo de vida de una suscripcion, en un solo lugar.
 *
 * Estaban repetidas en dos servicios y ademas duplicadas en el .env, que es la
 * peor combinacion: tres copias del mismo numero y ninguna que mande. El valor
 * por defecto vive aca.
 *
 * La variable de entorno se sigue leyendo, pero como override opcional: si
 * algun dia hay que cambiar la politica en un servidor puntual, se puede sin
 * recompilar. Si no esta definida —que es lo normal— manda el default de abajo.
 */

export const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Dias de tolerancia despues del vencimiento antes de dar por caida una
 * suscripcion.
 *
 * En 0 vencida es vencida el mismo dia, aunque la transferencia haya entrado
 * esa manana. En 3 se absorbe ese caso, con la contra de que el unico chequeo
 * mensual del POS cae justo dentro de esa ventana.
 */
export const DIAS_GRACIA = Number.parseInt(process.env.DIAS_GRACIA ?? '3', 10) || 0;

/**
 * Dias de calendario que faltan para una fecha.
 *
 * A proposito NO cuenta horas transcurridas: lo que a la gente le importa es
 * en que dia cae, no cuantas horas faltan. Contando horas, algo que vence hoy
 * a las 20:00 daba 1 y el panel lo anunciaba como "vence manana"; contando
 * dias de calendario da 0 y dice "vence hoy", que es lo que uno espera leer.
 *
 * Negativo si la fecha ya paso.
 */
export function diasDeCalendarioHasta(fecha: Date, desde: Date = new Date()): number {
  const soloDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((soloDia(fecha) - soloDia(desde)) / MS_POR_DIA);
}
