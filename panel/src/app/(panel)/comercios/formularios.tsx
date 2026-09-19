'use client';

import { Pencil, Plus, Bot } from 'lucide-react';
import { crearComercio, eliminarComercio, renombrarComercio, ajustarCupoBinny } from '@/actions/comercios';
import { AccionModal } from '@/components/ui/accion-modal';
import { BotonAccion } from '@/components/ui/boton-accion';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { Comercio } from '@/lib/tipos';

export function NuevoComercio() {
  return (
    <AccionModal
      disparador={
        <Button>
          <Plus /> Nuevo comercio
        </Button>
      }
      titulo="Nuevo comercio"
      descripcion="Se crea sin licencias. Las emite la suscripción cuando le contrates un plan, según el cupo que ese plan declare."
      accion={crearComercio}
      textoGuardar="Crear comercio"
    >
      <Field label="Nombre del comercio" htmlFor="nombre">
        <Input id="nombre" name="nombre" placeholder="Almacén San Martín" required minLength={2} autoFocus />
      </Field>
    </AccionModal>
  );
}

export function RenombrarComercio({ comercio }: { comercio: Comercio }) {
  return (
    <AccionModal
      disparador={
        <Button variant="outline" size="sm">
          <Pencil /> Renombrar
        </Button>
      }
      titulo="Renombrar comercio"
      accion={renombrarComercio}
      textoGuardar="Guardar"
    >
      <input type="hidden" name="id" value={comercio.id} />
      <Field label="Nombre del comercio" htmlFor="nombre-editar">
        <Input id="nombre-editar" name="nombre" defaultValue={comercio.nombre} required minLength={2} />
      </Field>
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
  const placeholder = override == null ? 'usa plan (vacío)' : String(override);
  const esIlimitado = override === 0;
  return (
    <AccionModal
      disparador={
        <Button variant="outline" size="sm" title={override == null ? 'Sin override: usa el plan' : esIlimitado ? 'Cupo ilimitado para este comercio' : `${override} mensajes/mes para este comercio`}>
          <Bot /> Cupo Binny {override == null ? '(plan)' : esIlimitado ? '(∞)' : `(${override})`}
        </Button>
      }
      titulo={`Cupo de Binny — ${comercio.nombre}`}
      descripcion="Override por comercio. Vacío = usa el cupo del plan contratado. 0 = ilimitado solo para este comercio. Entero >0 = límite mensual custom. Se aplica de inmediato al próximo mensaje."
      accion={ajustarCupoBinny}
      textoGuardar="Guardar cupo"
    >
      <input type="hidden" name="id" value={comercio.id} />
      <Field label="Consultas mensuales de Binny para este comercio" htmlFor={`cupo-${comercio.id}`}>
        <Input
          id={`cupo-${comercio.id}`}
          name="chat_mensajes_override"
          type="number"
          min={0}
          step={1}
          placeholder="Vacío = usa plan"
          defaultValue={override ?? ''}
        />
      </Field>
      <p className="text-xs text-muted-foreground mt-2">
        Ej: <code className="px-1 py-0.5 rounded bg-muted">500</code> para este comercio, <code className="px-1 py-0.5 rounded bg-muted">0</code> para ilimitado, vacío para volver al plan ({placeholder}).
      </p>
    </AccionModal>
  );
}
