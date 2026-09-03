import Link from 'next/link';
import { LogoMarca } from '@/components/marca/logo';
import { Button } from '@/components/ui/button';

export default function NoEncontrado() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <LogoMarca className="size-11" />
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">Error 404</p>
        <h1 className="text-2xl font-semibold tracking-tight">Esta página no existe.</h1>
      </div>
      <Button asChild variant="outline">
        <Link href="/dashboard">Volver al panel</Link>
      </Button>
    </main>
  );
}
