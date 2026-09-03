import { Badge } from '@/components/ui/badge';
import type { EstadoSuscripcion } from '@/lib/tipos';

const CONFIG: Record<EstadoSuscripcion, { texto: string; variante: 'success' | 'warning' | 'danger' | 'secondary' }> = {
  ACTIVA: { texto: 'Activa', variante: 'success' },
  EN_GRACIA: { texto: 'En gracia', variante: 'warning' },
  VENCIDA: { texto: 'Vencida', variante: 'danger' },
  CANCELADA: { texto: 'Cancelada', variante: 'secondary' },
};

export function EstadoDeSuscripcion({ estado }: { estado: EstadoSuscripcion }) {
  const config = CONFIG[estado] ?? CONFIG.CANCELADA;
  return <Badge variant={config.variante}>{config.texto}</Badge>;
}
