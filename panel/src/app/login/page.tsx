import type { Metadata } from 'next';
import { LogoMarca } from '@/components/marca/logo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormularioLogin } from './formulario';

export const metadata: Metadata = { title: 'Ingresar' };

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string; vencida?: string }>;
}) {
  const { volver, vencida } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMarca className="size-11" />
          <div>
            <h1 className="font-marca text-xl font-bold tracking-tight">Binario Dev Labs</h1>
            <p className="text-muted-foreground text-sm">Panel de administración</p>
          </div>
        </div>

        {vencida && (
          <Alert variant="warning">
            <AlertDescription>Tu sesión venció. Volvé a ingresar.</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Entrar al panel</CardTitle>
            <CardDescription>Licencias, suscripciones y cobranza del sistema POS.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormularioLogin volver={volver} />
          </CardContent>
        </Card>

        <p className="text-muted-foreground text-center text-xs">binariodevlabs.com</p>
      </div>
    </main>
  );
}
