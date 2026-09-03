'use client';

import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { salir } from '@/actions/auth';

export function BarraUsuario({ email }: { email: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground hidden text-sm sm:block">{email}</span>
      <form action={salir}>
        <Button type="submit" variant="ghost" size="icon" title="Cerrar sesión">
          <LogOut />
          <span className="sr-only">Cerrar sesión</span>
        </Button>
      </form>
    </div>
  );
}
