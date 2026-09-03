'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { iniciarSesion, type EstadoLogin } from '@/actions/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

function BotonEnviar() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Verificando...' : 'Ingresar'}
    </Button>
  );
}

export function FormularioLogin({ volver }: { volver?: string }) {
  const [estado, accion] = useActionState<EstadoLogin, FormData>(iniciarSesion, {});

  return (
    <form action={accion} className="grid gap-5">
      <input type="hidden" name="volver" value={volver ?? ''} />

      <FieldGroup>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={estado.email}
            placeholder="nombre@binario.com"
            required
            autoFocus
          />
        </Field>

        <Field label="Contraseña" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••"
            required
          />
        </Field>
      </FieldGroup>

      {estado.error && (
        <Alert variant="destructive">
          <AlertDescription>{estado.error}</AlertDescription>
        </Alert>
      )}

      <BotonEnviar />
    </form>
  );
}
