'use client';

import { Pencil, Plus } from 'lucide-react';
import { actualizarPlan, alternarPlan, crearPlan } from '@/actions/planes';
import { AccionModal } from '@/components/ui/accion-modal';
import { BotonAccion } from '@/components/ui/boton-accion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Plan } from '@/lib/tipos';

/** Campos compartidos por alta y edición; el código solo aparece en el alta. */
function CamposPlan({ plan }: { plan?: Plan }) {
  return (
    <>
      <Field label="Nombre visible" htmlFor="nombre">
        <Input id="nombre" name="nombre" defaultValue={plan?.nombre} placeholder="Pro" required />
      </Field>

      <Field
        label="Descripción"
        htmlFor="descripcion"
        description="Una línea. Es lo que se ve al elegir el plan de un comercio."
      >
        <Textarea
          id="descripcion"
          name="descripcion"
          defaultValue={plan?.descripcion ?? ''}
          placeholder="Un servidor y hasta dos clientes conectados a él."
        />
      </Field>

      <FieldRow>
        <Field label="Precio mensual (ARS)" htmlFor="precio_mensual">
          <Input
            id="precio_mensual"
            name="precio_mensual"
            type="number"
            min={0}
            step={1}
            defaultValue={plan?.precio_mensual ?? 0}
            required
          />
        </Field>
        <Field label="Precio anual (ARS)" htmlFor="precio_anual" description="Opcional. Vacío = doce veces el mensual.">
          <Input
            id="precio_anual"
            name="precio_anual"
            type="number"
            min={0}
            step={1}
            defaultValue={plan?.precio_anual ?? ''}
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Servidores" htmlFor="max_servidores" description="Licencias con rol SERVIDOR.">
          <Input
            id="max_servidores"
            name="max_servidores"
            type="number"
            min={0}
            max={50}
            defaultValue={plan?.max_servidores ?? 1}
            required
          />
        </Field>
        <Field label="Clientes" htmlFor="max_clientes" description="Licencias con rol CLIENTE. Básico = 0, Pro = 2.">
          <Input
            id="max_clientes"
            name="max_clientes"
            type="number"
            min={0}
            max={200}
            defaultValue={plan?.max_clientes ?? 0}
            required
          />
        </Field>
      </FieldRow>

      <Field label="Mensajes chat mensuales" htmlFor="chat_mensajes_mes" description="0 = ilimitado. Si no se define plan, usa el default del sistema.">
        <Input
          id="chat_mensajes_mes"
          name="chat_mensajes_mes"
          type="number"
          min={0}
          defaultValue={plan?.chat_mensajes_mes ?? 500}
          required
        />
      </Field>

      <div className="flex items-center gap-2.5">
        <Checkbox id="activo" name="activo" defaultChecked={plan?.activo ?? true} />
        <Label htmlFor="activo" className="font-normal">
          Se ofrece a comercios nuevos
        </Label>
      </div>
    </>
  );
}

export function NuevoPlan() {
  return (
    <AccionModal
      disparador={
        <Button>
          <Plus /> Nuevo plan
        </Button>
      }
      titulo="Nuevo plan"
      descripcion="El código es la referencia estable del plan y después no se cambia."
      accion={crearPlan}
      textoGuardar="Crear plan"
    >
      <Field label="Código" htmlFor="codigo" description="Mayúsculas, números y guion bajo. Ej: BASICO, PRO, PRO_PLUS.">
        <Input id="codigo" name="codigo" placeholder="PRO_PLUS" required pattern="[A-Za-z0-9_]+" />
      </Field>
      <CamposPlan />
    </AccionModal>
  );
}

export function EditarPlan({ plan }: { plan: Plan }) {
  return (
    <AccionModal
      disparador={
        <Button variant="outline" size="sm">
          <Pencil /> Editar
        </Button>
      }
      titulo={`Editar ${plan.nombre}`}
      descripcion={`Código ${plan.codigo}. Cambiar el precio no afecta a las suscripciones ya contratadas.`}
      accion={actualizarPlan}
      textoGuardar="Guardar cambios"
    >
      <input type="hidden" name="id" value={plan.id} />
      <CamposPlan plan={plan} />
    </AccionModal>
  );
}

export function AlternarPlan({ plan }: { plan: Plan }) {
  return (
    <BotonAccion
      variant="ghost"
      size="sm"
      accion={() => alternarPlan(plan.id, !plan.activo)}
      confirmacion={plan.activo ? 'Confirmar' : undefined}
    >
      {plan.activo ? 'Desactivar' : 'Reactivar'}
    </BotonAccion>
  );
}
