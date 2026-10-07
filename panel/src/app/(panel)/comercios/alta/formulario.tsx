'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Plus } from 'lucide-react';
import { crearComercioConClaves, type CrearComercioConClavesEstado } from '@/actions/comercios';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LicenciaListada, Plan, RolLicencia } from '@/lib/tipos';

const ETIQUETA_ROL: Record<RolLicencia, string> = {
  SERVIDOR: 'Servidor (la caja)',
  CLIENTE: 'Cliente (terminal)',
};

/**
 * Alta con la forma real del negocio: primero se generan las claves sueltas y
 * despues se crea el comercio eligiendo cuaales de esas claves usar. El backend
 * valida el cupo del plan sobre lo que se asigna, no sobre lo que se genera.
 *
 * No va en un AccionModal porque el resultado importa: tras crear, el formulario
 * confirma que la clave quedo asignada y muestra el camino a Comercios.
 */
export function FormularioAltaComercio({ planes, claves }: { planes: Plan[]; claves: LicenciaListada[] }) {
  const [estado, accion, pendiente] = useActionState<CrearComercioConClavesEstado, FormData>(
    crearComercioConClaves,
    {}
  );
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());

  const grupos = useMemo(
    () => ({
      SERVIDOR: claves.filter((clave) => clave.rol === 'SERVIDOR'),
      CLIENTE: claves.filter((clave) => clave.rol === 'CLIENTE'),
    }),
    [claves]
  );

  const alternar = (id: string) => (marcado: boolean) => {
    setSeleccion((actual) => {
      const siguiente = new Set(actual);
      if (marcado) siguiente.add(id);
      else siguiente.delete(id);
      return siguiente;
    });
  };

  const asignadas = estado.licencias_asignadas ?? [];

  return (
    <div className="max-w-2xl space-y-6">
      <form action={accion} className="space-y-6">
        <FieldGroup>
          <Field label="Nombre del comercio" htmlFor="nombre">
            <Input id="nombre" name="nombre" placeholder="Almacén San Martín" required minLength={2} autoFocus />
          </Field>

          <FieldRow>
            <Field label="Teléfono" htmlFor="telefono" description="Opcional. Se puede completar después.">
              <Input id="telefono" name="telefono" type="tel" placeholder="11 5555 5555" maxLength={40} />
            </Field>
            <Field label="Email" htmlFor="email" description="Opcional. El backend valida el formato.">
              <Input id="email" name="email" type="email" placeholder="contacto@comercio.com" maxLength={160} />
            </Field>
          </FieldRow>

          <Field label="Plan" description="Define el cupo de claves servidor y cliente que el comercio puede tener.">
            <Select name="plan_id" required>
              <SelectTrigger>
                <SelectValue placeholder="Elegí un plan" />
              </SelectTrigger>
              <SelectContent>
                {planes.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id}>
                    {plan.nombre} — {plan.max_servidores} servidor{plan.max_servidores === 1 ? '' : 'es'} /{' '}
                    {plan.max_clientes} cliente{plan.max_clientes === 1 ? '' : 's'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Claves libres"
            description="Elegí las claves que querés asignarle. Podés dejarlo vacío y asignarlas más adelante."
          >
            {claves.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No hay claves libres. Generá algunas en{' '}
                <Link href="/licencias" className="text-foreground underline-offset-2 hover:underline">
                  Claves
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-4">
                {(Object.keys(grupos) as RolLicencia[]).map((rol) =>
                  grupos[rol].length === 0 ? null : (
                    <div key={rol} className="space-y-2">
                      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                        {ETIQUETA_ROL[rol]} (
                        {grupos[rol].filter((clave) => seleccion.has(clave.id)).length} de {grupos[rol].length})
                      </p>
                      <ul className="divide-y rounded-md border">
                        {grupos[rol].map((clave) => (
                          <li key={clave.id} className="flex items-center gap-3 px-3 py-2">
                            <Checkbox
                              id={`clave-${clave.id}`}
                              checked={seleccion.has(clave.id)}
                              onCheckedChange={(marcado) => alternar(clave.id)(marcado === true)}
                            />
                            <label
                              htmlFor={`clave-${clave.id}`}
                              className="flex-1 cursor-pointer font-mono text-sm"
                            >
                              {clave.clave_original ?? '(no disponible)'}
                            </label>
                            <KeyRound className="text-muted-foreground size-3.5" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                )}
              </div>
            )}
          </Field>
        </FieldGroup>

        {/* Los ids viajan como campos ocultos: el submit no depende del
            bubbling interno del checkbox de Radix. */}
        {[...seleccion].map((id) => (
          <input key={id} type="hidden" name="licencia_ids" value={id} />
        ))}

        {estado.error && (
          <Alert variant="destructive">
            <AlertDescription>{estado.error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pendiente || planes.length === 0}>
            <Plus /> {pendiente ? 'Creando...' : 'Crear comercio'}
          </Button>
          {seleccion.size > 0 && (
            <span className="text-muted-foreground text-sm">
              {seleccion.size} {seleccion.size === 1 ? 'clave seleccionada' : 'claves seleccionadas'}
            </span>
          )}
        </div>
      </form>

      {estado.ok && estado.comercio && (
        <Alert>
          <CheckCircle2 />
          <AlertDescription>
            <strong>{estado.comercio.nombre}</strong> quedó creado
            {asignadas.length > 0
              ? ` con ${asignadas.length} ${asignadas.length === 1 ? 'clave asignada' : 'claves asignadas'}.`
              : ' con su plan, sin claves asignadas todavía.'}{' '}
            <Link href="/comercios" className="text-foreground underline-offset-2 hover:underline">
              Ver comercios
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
