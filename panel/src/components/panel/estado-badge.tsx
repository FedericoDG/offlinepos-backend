import { Badge } from '@/components/ui/badge';
import type { RolLicencia } from '@/lib/tipos';

/**
 * Badges de estado del panel. Viven juntos para que el mismo concepto se lea
 * igual en todas las pantallas: una clave activa es verde en Comercios y en
 * Claves, una deuda vencida es roja en la lista y en el detalle.
 */

/** Estado de una clave: activa (verde) o suspendida (ámbar). */
export function BadgeEstadoClave({ estado }: { estado: string }) {
  const activa = estado === 'activa';
  return <Badge variant={activa ? 'success' : 'warning'}>{activa ? 'activa' : 'suspendida'}</Badge>;
}

/** Rol de la clave: el servidor es la caja; el cliente, una terminal. */
export function BadgeRolClave({ rol }: { rol: RolLicencia }) {
  return <Badge variant={rol === 'SERVIDOR' ? 'info' : 'secondary'}>{rol === 'SERVIDOR' ? 'Servidor' : 'Cliente'}</Badge>;
}

/** Deuda estimada: al día en verde, con períodos en rojo. */
export function BadgeDeuda({ alDia, periodos }: { alDia: boolean; periodos: number }) {
  if (alDia) return <Badge variant="success">Al día</Badge>;
  return (
    <Badge variant="danger">
      Debe {periodos} {periodos === 1 ? 'período' : 'períodos'}
    </Badge>
  );
}

/** Plan del comercio. Sin plan se muestra en ámbar para que salte a la vista. */
export function BadgePlan({ nombre }: { nombre?: string | null }) {
  if (!nombre) return <Badge variant="warning">Sin plan</Badge>;
  return <Badge variant="info">{nombre}</Badge>;
}
