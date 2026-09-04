/** Formateo para es-AR: es el idioma del panel y de los comercios. */

const MONEDA = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

const MONEDA_CENTAVOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

export function plata(valor: number | null | undefined, conCentavos = false): string {
  const numero = Number(valor ?? 0);
  return conCentavos ? MONEDA_CENTAVOS.format(numero) : MONEDA.format(numero);
}

export function numero(valor: number | null | undefined): string {
  return new Intl.NumberFormat('es-AR').format(Number(valor ?? 0));
}

export function porcentaje(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  const signo = valor > 0 ? '+' : '';
  return `${signo}${valor.toFixed(1)}%`;
}

export function fecha(valor: string | Date | null | undefined): string {
  if (!valor) return '—';
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function fechaLarga(valor: string | Date | null | undefined): string {
  if (!valor) return '—';
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

/** Para <input type="date">, que solo entiende yyyy-mm-dd. */
export function fechaInput(valor: string | Date | null | undefined): string {
  if (!valor) return '';
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(d.getTime())) return '';
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * "vence en 8 dias" / "vencio hace 2 dias". El signo importa mas que el
 * numero: es lo que separa un recordatorio de un reclamo.
 */
export function vencimiento(dias: number): string {
  if (dias === 0) return 'vence hoy';
  if (dias === 1) return 'vence mañana';
  if (dias > 0) return `vence en ${dias} días`;
  if (dias === -1) return 'venció ayer';
  return `venció hace ${Math.abs(dias)} días`;
}
