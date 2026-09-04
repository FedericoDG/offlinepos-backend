'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, MonitorX, Plus } from 'lucide-react';
import { emitirLicencia, liberarActivacion } from '@/actions/licencias';
import { AccionModal } from '@/components/ui/accion-modal';
import { Button } from '@/components/ui/button';
import { Field, FieldRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BotonAccion } from '@/components/ui/boton-accion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { fecha } from '@/lib/formato';
import type { Comercio, LicenciaListada, RolLicencia, Suscripcion } from '@/lib/tipos';

/**
 * Emisión manual, para casos excepcionales: reponer una clave que se perdió,
 * o habilitar un puesto fuera de plan a propósito. El camino normal es
 * contratar el plan, que emite el cupo solo.
 */
export function EmitirLicencia({
  comercios,
  suscripciones,
}: {
  comercios: Comercio[];
  suscripciones: Suscripcion[];
}) {
  const [comercioId, setComercioId] = useState('');
  const [rol, setRol] = useState<RolLicencia>('SERVIDOR');

  /**
   * El mismo cálculo que hace el backend, adelantado acá. No reemplaza a la
   * validación del servidor —esa es la que manda— pero evita mandar un
   * formulario que ya sabemos que va a volver rechazado.
   */
  const bloqueo = useMemo(() => {
    if (!comercioId) return undefined;

    const comercio = comercios.find((c) => c.id === comercioId);
    const suscripcion = suscripciones.find((s) => s.comercio.id === comercioId && s.estado !== 'CANCELADA');
    if (!comercio) return undefined;

    if (!suscripcion?.plan) {
      return 'Este comercio no tiene un plan contratado. Contratale un plan desde Suscripciones y las licencias se emiten solas.';
    }

    const esServidor = rol === 'SERVIDOR';
    const cupo = esServidor ? suscripcion.plan.max_servidores : suscripcion.plan.max_clientes;
    const etiqueta = esServidor ? 'servidor' : 'cliente';
    const plural = esServidor ? 'servidores' : 'clientes';
    const activas = comercio.licencias.filter((l) => l.estado === 'activa' && l.rol === rol).length;

    if (cupo === 0) {
      return `El plan ${suscripcion.plan.nombre} no incluye licencias de ${etiqueta}. Mejorá el plan del comercio para habilitarlas.`;
    }

    if (activas >= cupo) {
      return `El plan ${suscripcion.plan.nombre} cubre ${cupo} ${cupo === 1 ? etiqueta : plural} y el comercio ya tiene ${activas} ${activas === 1 ? 'activa' : 'activas'}. Mejorá el plan para sumar otra.`;
    }

    return undefined;
  }, [comercioId, rol, comercios, suscripciones]);

  return (
    <AccionModal
      disparador={
        <Button variant="outline" disabled={comercios.length === 0}>
          <Plus /> Emitir licencia suelta
        </Button>
      }
      titulo="Emitir licencia suelta"
      descripcion="Fuera del cupo del plan. Para el alta normal, contratá el plan desde Suscripciones y las licencias salen solas."
      accion={emitirLicencia}
      textoGuardar="Emitir"
      bloqueo={bloqueo}
    >
      <Field label="Comercio">
        <Select name="comercio_id" required value={comercioId} onValueChange={setComercioId}>
          <SelectTrigger>
            <SelectValue placeholder="Elegí un comercio" />
          </SelectTrigger>
          <SelectContent>
            {comercios.map((comercio) => (
              <SelectItem key={comercio.id} value={comercio.id}>
                {comercio.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <FieldRow>
        <Field label="Rol">
          <Select name="rol" value={rol} onValueChange={(v) => setRol(v as RolLicencia)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SERVIDOR">Servidor (la caja)</SelectItem>
              <SelectItem value="CLIENTE">Cliente (terminal)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Activaciones"
          htmlFor="max_activaciones"
          description="Se descuenta una por cada instalación nueva."
        >
          <Input id="max_activaciones" name="max_activaciones" type="number" min={1} max={1000} defaultValue={1} required />
        </Field>
      </FieldRow>

      <Field label="Clave" htmlFor="clave" description="Vacía = la genera el backend, única y con el formato de siempre.">
        <Input id="clave" name="clave" className="font-mono uppercase" placeholder="LIC-2026-XXXX-XXXX" minLength={6} />
      </Field>
    </AccionModal>
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
 * Cambio de PC, que es el pedido de soporte más común.
 *
 * Muestra qué máquinas ocupan la licencia y permite soltar la que ya no está.
 * El comercio no recibe una clave nueva: sigue usando la que tiene anotada, y
 * el cupo del plan no se mueve.
 */
export function LiberarActivaciones({ licencia }: { licencia: LicenciaListada }) {
  if (licencia.activaciones.length === 0) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MonitorX /> Instalaciones
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instalaciones de {licencia.comercio.nombre}</DialogTitle>
          <DialogDescription>
            Si el comercio cambió de PC, liberá la vieja: el puesto queda libre y puede activar{' '}
            <span className="text-foreground font-mono text-xs">{licencia.clave_original}</span> en la máquina nueva.
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
