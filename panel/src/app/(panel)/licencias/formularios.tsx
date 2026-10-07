'use client';

import { useEffect, useActionState, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, MonitorX, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import {
  cambiarEstadoLicencia,
  eliminarLicencia,
  generarClaves,
  liberarActivacion,
  type GenerarClavesEstado,
} from '@/actions/licencias';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { BotonAccion } from '@/components/ui/boton-accion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { fecha } from '@/lib/formato';
import type { LicenciaListada } from '@/lib/tipos';

/**
 * Genera claves sueltas ("libres"). Todavía no pertenecen a un comercio: se
 * asignan al dar de alta uno. Al confirmar, el modal se cierra y las claves
 * quedan listas para copiar desde la tabla (ahí vive el botón de copiado).
 */
export function GenerarClaves() {
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, pendiente] = useActionState<GenerarClavesEstado, FormData>(generarClaves, {});

  // Al terminar una generación exitosa: aviso y cierre del modal. El error
  // (si lo hay) se muestra adentro y el modal queda abierto para corregir.
  useEffect(() => {
    if (!estado.licencias?.length) return;
    toast.success(
      estado.licencias.length === 1
        ? 'Clave generada. Ya podés copiarla desde la tabla.'
        : `${estado.licencias.length} claves generadas. Ya podés copiarlas desde la tabla.`,
    );
    setAbierto(false);
  }, [estado]);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Generar claves
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generar claves</DialogTitle>
          <DialogDescription>
            Las claves quedan libres hasta que las asignes al crear un comercio. El cupo del plan se controla en ese
            momento, no acá.
          </DialogDescription>
        </DialogHeader>

        <form action={accion} className="grid gap-6">
          <FieldGroup>
            <Field
              label="Cantidad"
              htmlFor="cantidad"
              description="Hasta 50 por tanda. Todas las claves son de servidor."
            >
              <Input id="cantidad" name="cantidad" type="number" min={1} max={50} defaultValue={1} required />
            </Field>
          </FieldGroup>

          {estado.error && (
            <Alert variant="destructive">
              <AlertDescription>{estado.error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
              Cerrar
            </Button>
            <Button type="submit" disabled={pendiente}>
              {pendiente ? 'Generando...' : 'Generar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** La clave es lo único que hay que pasarle al comercio: copiarla tiene que ser un clic. */
export function CopiarClave({ clave }: { clave: string }) {
  const [copiada, setCopiada] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      title="Copiar clave"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(clave);
          setCopiada(true);
          setTimeout(() => setCopiada(false), 1600);
        } catch {
          setCopiada(false);
        }
      }}
    >
      {copiada ? <Check className="text-[var(--success)]" /> : <Copy />}
      <span className="sr-only">Copiar clave</span>
    </Button>
  );
}

/**
 * Acciones de fila: desactivar/reactivar y borrar. Desactivar es la salida
 * cuando la clave tiene historial; borrar solo procede si está libre de
 * referencias, y si no, el 409 del backend explica por qué.
 */
export function AccionesLicencia({ licencia }: { licencia: LicenciaListada }) {
  const activa = licencia.estado === 'activa';

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <BotonAccion
        variant="ghost"
        size="sm"
        accion={() => cambiarEstadoLicencia(licencia.id, activa ? 'suspendida' : 'activa')}
        confirmacion={activa ? 'Confirmar' : undefined}
      >
        {activa ? <PowerOff /> : <Power />}
        {activa ? 'Desactivar' : 'Activar'}
      </BotonAccion>
      <BotonAccion
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        accion={() => eliminarLicencia(licencia.id)}
        confirmacion="Confirmar"
      >
        <Trash2 /> Borrar
      </BotonAccion>
    </div>
  );
}

/**
 * Cambio de PC, que es el pedido de soporte más común.
 *
 * Muestra qué máquinas ocupan la licencia y permite soltar la que ya no está.
 * El comercio no recibe una clave nueva: sigue usando la que tiene anotada, y
 * el cupo del plan no se mueve.
 */
export function LiberarActivaciones({ licencia }: { licencia: LicenciaListada }) {
  if (licencia.activaciones.length === 0) return null;

  const comercio = licencia.comercio?.nombre ?? 'la clave';

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MonitorX /> Instalaciones
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instalaciones de {comercio}</DialogTitle>
          <DialogDescription>
            Si el comercio cambió de PC, liberá la vieja: el puesto queda libre y puede activar{' '}
            <span className="text-foreground font-mono text-xs">{licencia.clave_original ?? '(no disponible)'}</span> en
            la máquina nueva.
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y rounded-md border">
          {licencia.activaciones.map((activacion) => (
            <li key={activacion.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs">{activacion.instalacion_id.slice(0, 20)}…</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  última validación {fecha(activacion.ultima_validacion)}
                </p>
              </div>
              <BotonAccion
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                accion={() => liberarActivacion(licencia.id, activacion.id)}
                confirmacion="Confirmar"
              >
                Liberar
              </BotonAccion>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground text-xs leading-relaxed">
          Liberá justo antes de que el comercio active la máquina nueva. Si la vieja sigue encendida y con internet,
          en su próxima revalidación vuelve a tomar el puesto que acabás de soltar.
        </p>
      </DialogContent>
    </Dialog>
  );
}
