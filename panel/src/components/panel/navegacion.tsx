'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Building2, CreditCard, KeyRound, Layers, MessageSquare, Receipt, Rocket } from 'lucide-react';
import { cn } from '@/lib/utils';

const SECCIONES = [
  { href: '/dashboard', etiqueta: 'Dashboard', icono: BarChart3 },
  { href: '/comercios', etiqueta: 'Comercios', icono: Building2 },
  { href: '/licencias', etiqueta: 'Licencias', icono: KeyRound },
  { href: '/suscripciones', etiqueta: 'Suscripciones', icono: CreditCard },
  { href: '/planes', etiqueta: 'Planes', icono: Layers },
  { href: '/pagos', etiqueta: 'Pagos', icono: Receipt },
  { href: '/chat', etiqueta: 'Consumo Chat', icono: MessageSquare },
  { href: '/actualizaciones', etiqueta: 'Actualizaciones', icono: Rocket },
];

export function Navegacion({ horizontal = false }: { horizontal?: boolean }) {
  const ruta = usePathname();

  return (
    <nav className={cn('flex gap-1', horizontal ? 'flex-row px-3 py-2' : 'flex-col px-3')}>
      {SECCIONES.map((seccion) => {
        const activa = ruta === seccion.href || ruta.startsWith(`${seccion.href}/`);
        const Icono = seccion.icono;

        return (
          <Link
            key={seccion.href}
            href={seccion.href}
            aria-current={activa ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
              activa
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
            )}
          >
            <Icono className={cn('size-4 shrink-0', activa && 'text-primary')} strokeWidth={2} />
            {seccion.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
