'use client';

import { Pencil, Plus, Bot } from 'lucide-react';
import { crearComercio, eliminarComercio, editarComercio, ajustarCupoBinny } from '@/actions/comercios';
import { AccionModal } from '@/components/ui/accion-modal';
import { BotonAccion } from '@/components/ui/boton-accion';
import { Button } from '@/components/ui/button';
import { Field, FieldRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { Comercio } from '@/lib/tipos';

/** Lo mínimo que necesita el modal de edición; lo comparten lista y detalle. */
export interface ComercioEditable {
  id: string;
  nombre: string;
  telefono?: string | null;
  email?: string | null;
}

export function NuevoComercio() {
  return (
    <AccionModal
      disparador={
        <Button>
          <Plus /> Nuevo comercio
        </Button>
      }
      titulo="Nuevo comercio"
      descripcion="Se crea sin licencias ni plan. Para el camino normal usá Nuevo comercio: crea el comercio, le asigna el plan y le asigna sus claves en un paso."
      accion={crearComercio}
      textoGuardar="Crear comercio"
    >
      <Field label="Nombre del comercio" htmlFor="nombre">
        <Input id="nombre" name="nombre" placeholder="Almacén San Martín" required minLength={2} autoFocus />
      </Field>
      <FieldRow>
        <Field label="Teléfono" htmlFor="telefono" description="Opcional. Se puede completar después.">
          <Input id="telefono" name="telefono" type="tel" placeholder="11 5555 5555" maxLength={40} />
        </Field>
        <Field label="Email" htmlFor="email" description="Opcional.">
          <Input id="email" name="email" type="email" placeholder="contacto@comercio.com" maxLength={160} />
        </Field>
      </FieldRow>
    </AccionModal>
  );
}

/**
 * Edita nombre y contacto. Antes era solo "renombrar": ahora el mismo modal
 * cubre los tres campos, que es lo que se toca en la práctica.
 */
export function EditarComercio({ comercio }: { comercio: ComercioEditable }) {
  return (
    <AccionModal
      disparador={
        <Button variant="outline" size="sm">
          <Pencil /> Editar datos
        </Button>
      }
      titulo="Editar comercio"
      descripcion="El teléfono y el email son opcionales: dejarlos vacíos los borra."
      accion={editarComercio}
      textoGuardar="Guardar cambios"
    >
      <input type="hidden" name="id" value={comercio.id} />
      <Field label="Nombre del comercio" htmlFor="nombre-editar">
        <Input id="nombre-editar" name="nombre" defaultValue={comercio.nombre} required minLength={2} />
      </Field>
      <FieldRow>
        <Field label="Teléfono" htmlFor="telefono-editar" description="Opcional. Vacío = sin teléfono.">
          <Input
            id="telefono-editar"
            name="telefono"
            type="tel"
            defaultValue={comercio.telefono ?? ''}
            placeholder="11 5555 5555"
            maxLength={40}
          />
        </Field>
        <Field label="Email" htmlFor="email-editar" description="Opcional. El backend valida el formato.">
          <Input
            id="email-editar"
            name="email"
            type="email"
            defaultValue={comercio.email ?? ''}
            placeholder="contacto@comercio.com"
            maxLength={160}
          />
        </Field>
      </FieldRow>
    </AccionModal>
  );
}

export function EliminarComercio({ comercio }: { comercio: Comercio }) {
  return (
    <BotonAccion
      variant="ghost"
      size="sm"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      accion={() => eliminarComercio(comercio.id)}
      confirmacion="Borra todo"
    >
      Eliminar
    </BotonAccion>
  );
}

export function AjustarCupoBinny({ comercio }: { comercio: Comercio }) {
  const override = comercio.chat_mensajes_override;
  const esIlimitado = override === 0;
  // Cupo efectivo: lo que realmente va a tener el comercio si no se toca nada.
  const delPlan = comercio.plan?.chat_mensajes_mes ?? null;
  const efectivo = override ?? delPlan;
  const efectivoTexto =
    efectivo == null ? '—' : efectivo === 0 ? 'ilimitado' : `${efectivo} mensajes/mes`;
  const origen =
    override == null
      ? comercio.plan
        ? `del plan ${comercio.plan.nombre}`
        : 'sin plan asignado'
      : 'override de este comercio';
  const placeholder = override == null ? (delPlan != null ? String(delPlan) : 'usa plan') : String(override);
  return (
    <AccionModal
      disparador={
        <Button
          variant="outline"
          size="sm"
          title={`Cupo actual: ${efectivoTexto} (${origen})`}
        >
          <Bot /> Cupo Binny {override == null ? `(${delPlan == null ? 'plan' : `${delPlan} del plan`})` : esIlimitado ? '(∞)' : `(${override})`}
        </Button>
      }
      titulo={`Cupo de Binny — ${comercio.nombre}`}
      descripcion="El cupo es del comercio: se comparte entre todas sus claves (servidor y clientes). Vacío = usa el cupo del plan contratado. 0 = ilimitado solo para este comercio. Entero >0 = límite mensual custom. Se aplica de inmediato al próximo mensaje."
      accion={ajustarCupoBinny}
      textoGuardar="Guardar cupo"
    >
      <input type="hidden" name="id" value={comercio.id} />
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Cupo actual: </span>
        <span className="font-semibold">{efectivoTexto}</span>
        <span className="text-muted-foreground"> · {origen}</span>
      </div>
      <Field label="Consultas mensuales de Binny para este comercio" htmlFor={`cupo-${comercio.id}`}>
        <Input
          id={`cupo-${comercio.id}`}
          name="chat_mensajes_override"
          type="number"
          min={0}
          step={1}
          placeholder={placeholder}
          defaultValue={override ?? ''}
        />
      </Field>
      <p className="text-xs text-muted-foreground mt-2">
        Ej: <code className="px-1 py-0.5 rounded bg-muted">500</code> para este comercio, <code className="px-1 py-0.5 rounded bg-muted">0</code> para ilimitado, vacío para volver al plan{delPlan != null ? ` (${delPlan})` : ''}.
      </p>
    </AccionModal>
  );
}
