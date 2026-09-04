import { redirect } from 'next/navigation';
import { LogoCompleto } from '@/components/marca/logo';
import { Navegacion } from '@/components/panel/navegacion';
import { BarraUsuario } from '@/components/panel/barra-usuario';
import { leerSesion } from '@/lib/sesion';

export default async function LayoutPanel({ children }: { children: React.ReactNode }) {
  const sesion = await leerSesion();
  if (!sesion) redirect('/login');

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r lg:flex">
        <div>
          <div className="border-sidebar-border flex h-14 items-center border-b px-4">
            <LogoCompleto />
          </div>
          <div className="py-3">
            <Navegacion />
          </div>
        </div>

        <div className="border-sidebar-border text-muted-foreground border-t px-6 py-4 text-xs">
          Sistema POS &middot; v1
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b px-4 backdrop-blur lg:px-8">
          <div className="lg:hidden">
            <LogoCompleto />
          </div>
          <span className="text-muted-foreground hidden text-sm lg:block">Panel de administración</span>
          <BarraUsuario email={sesion.administrador.email} />
        </header>

        {/* Navegación horizontal para pantallas chicas. */}
        <div className="overflow-x-auto border-b lg:hidden">
          <Navegacion horizontal />
        </div>

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
