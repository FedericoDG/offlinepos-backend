'use client';

import { useState } from 'react';
import { Pencil, Plus, RefreshCw } from 'lucide-react';
import {
  actualizarSuscripcion,
  cancelarSuscripcion,
  crearSuscripcion,
  reactivarSuscripcion,
  renovarSuscripcion,
} from '@/actions/suscripciones';
import { AccionModal } from '@/components/ui/accion-modal';
import { BotonAccion } from '@/components/ui/boton-accion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fechaInput, plata } from '@/lib/formato';
import type { Comercio, Plan, Suscripcion } from '@/lib/tipos';

/** "1 servidor + 2 clientes": lo que el comercio recibe al contratar. */
function cupoDePlan(plan: Plan): string {
  const partes = [`${plan.max_servidores} ${plan.max_servidores === 1 ? 'servidor' : 'servidores'}`];
  if (plan.max_clientes > 0) {
    partes.push(`${plan.max_clientes} ${plan.max_clientes === 1 ? 'cliente' : 'clientes'}`);
  }
  return partes.join(' + ');
}

const METODOS = [
  ['TRANSFERENCIA', 'Transferencia'],
  ['EFECTIVO', 'Efectivo'],
  ['MERCADO_PAGO', 'Mercado Pago'],
  ['TARJETA', 'Tarjeta'],
  ['OTRO', 'Otro'],
] as const;

function SelectorMetodo({ name = 'metodo' }: { name?: string }) {
  return (
    <Select name={name} defaultValue="TRANSFERENCIA">
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {METODOS.map(([valor, texto]) => (
          <SelectItem key={valor} value={valor}>
            {texto}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function NuevaSuscripcion({ comercios, planes }: { comercios: Comercio[]; planes: Plan[] }) {
  const activos = planes.filter((p) => p.activo);

  return (
    <AccionModal
      disparador={
        <Button disabled={activos.length === 0 || comercios.length === 0}>
          <Plus /> Nueva suscripción
        </Button>
      }
      titulo="Nueva suscripción"
      descripcion="Contratar da por hecho que el comercio pagó: se asienta el primer pago y se emiten las licencias del plan, todo junto."
      accion={crearSuscripcion}
      textoGuardar="Contratar y cobrar"
    >
      <Field label="Comercio">
        <Select name="comercio_id" required>
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

      <Field label="Plan">
        <Select name="plan_id" required>
          <SelectTrigger>
            <SelectValue placeholder="Elegí un plan" />
          </SelectTrigger>
          <SelectContent>
            {activos.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.nombre} — {plata(plan.precio_mensual)}/mes ({cupoDePlan(plan)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <FieldRow>
        <Field label="Ciclo">
          <Select name="ciclo" defaultValue="MENSUAL">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MENSUAL">Mensual</SelectItem>
              <SelectItem value="ANUAL">Anual</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Precio pactado" htmlFor="precio_pactado" description="Vacío = el precio de lista del plan.">
          <Input id="precio_pactado" name="precio_pactado" type="number" min={0} step={1} placeholder="según el plan" />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Inicia" htmlFor="inicia_en" description="Vacío = hoy.">
          <Input id="inicia_en" name="inicia_en" type="date" />
        </Field>
        <Field label="Vence" htmlFor="vence_en" description="Vacío = un período después del inicio.">
          <Input id="vence_en" name="vence_en" type="date" />
        </Field>
      </FieldRow>

      <Field label="Nota" htmlFor="nota">
        <Textarea
          id="nota"
          name="nota"
          placeholder="Descuento acordado, contacto de cobranza, lo que haga falta recordar."
        />
      </Field>

      <div className="border-primary/40 grid gap-5 border-l-2 pl-5">
        <p className="text-sm font-medium">
          Primer pago
          <span className="text-muted-foreground ml-2 font-normal">
            se registra por el precio pactado, cubriendo el primer período
          </span>
        </p>

        <FieldRow>
          <Field label="Método">
            <SelectorMetodo name="metodo_pago" />
          </Field>
          <Field label="Fecha del cobro" htmlFor="pagado_en" description="Vacío = la fecha de inicio.">
            <Input id="pagado_en" name="pagado_en" type="date" />
          </Field>
        </FieldRow>

        <Field label="Referencia" htmlFor="referencia_pago" description="Nro. de operación, comprobante.">
          <Input id="referencia_pago" name="referencia_pago" placeholder="TRF-000123" />
        </Field>
      </div>
    </AccionModal>
  );
}

export function EditarSuscripcion({ suscripcion, planes }: { suscripcion: Suscripcion; planes: Plan[] }) {
  return (
    <AccionModal
      disparador={
        <Button variant="outline" size="sm">
          <Pencil /> Editar
        </Button>
      }
      titulo={`Suscripción de ${suscripcion.comercio.nombre}`}
      descripcion="Cambiar de plan reajusta las licencias: emite las que falten y suspende las que sobren."
      accion={actualizarSuscripcion}
      textoGuardar="Guardar cambios"
    >
      <input type="hidden" name="id" value={suscripcion.id} />

      <Field label="Plan">
        <Select name="plan_id" defaultValue={suscripcion.plan?.id ?? undefined}>
          <SelectTrigger>
            <SelectValue placeholder="Elegí un plan" />
          </SelectTrigger>
          <SelectContent>
            {planes.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.nombre} {plan.activo ? '' : '(discontinuado)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <FieldRow>
        <Field label="Ciclo">
          <Select name="ciclo" defaultValue={suscripcion.ciclo}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MENSUAL">Mensual</SelectItem>
              <SelectItem value="ANUAL">Anual</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Precio pactado" htmlFor="precio_pactado_editar">
          <Input
            id="precio_pactado_editar"
            name="precio_pactado"
            type="number"
            min={0}
            step={1}
            defaultValue={suscripcion.precio_pactado}
          />
        </Field>
      </FieldRow>

      <Field
        label="Vence"
        htmlFor="vence_en_editar"
        description="Mover esta fecha a mano es para corregir un error de carga, no para renovar."
      >
        <Input id="vence_en_editar" name="vence_en" type="date" defaultValue={fechaInput(suscripcion.vence_en)} />
      </Field>

      <Field label="Nota" htmlFor="nota_editar">
        <Textarea id="nota_editar" name="nota" defaultValue={suscripcion.nota ?? ''} />
      </Field>
    </AccionModal>
  );
}

/** Los campos del cobro solo aparecen si se marca que entró la plata. */
function CamposCobro({ sugerido }: { sugerido: number }) {
  const [cobrado, setCobrado] = useState(true);

  return (
    <>
      <div className="bg-muted/40 flex items-center gap-2.5 rounded-md border p-3">
        <Checkbox
          id="registrar_pago"
          name="registrar_pago"
          checked={cobrado}
          onCheckedChange={(valor) => setCobrado(valor === true)}
        />
        <Label htmlFor="registrar_pago" className="text-sm font-normal">
          Ya entró el pago: registrarlo junto con la renovación
        </Label>
      </div>

      {cobrado && (
        <div className="border-primary/40 grid gap-5 border-l-2 pl-5">
          <FieldRow>
            <Field label="Monto" htmlFor="monto" description={`Sugerido: ${plata(sugerido)}`}>
              <Input id="monto" name="monto" type="number" min={0} step={1} defaultValue={sugerido} />
            </Field>
            <Field label="Fecha del cobro" htmlFor="pagado_en" description="Vacío = hoy.">
              <Input id="pagado_en" name="pagado_en" type="date" />
            </Field>
          </FieldRow>

          <FieldRow>
            <Field label="Método">
              <SelectorMetodo />
            </Field>
            <Field label="Referencia" htmlFor="referencia" description="Nro. de operación, comprobante.">
              <Input id="referencia" name="referencia" placeholder="TRF-000123" />
            </Field>
          </FieldRow>
        </div>
      )}
    </>
  );
}

export function RenovarSuscripcion({ suscripcion }: { suscripcion: Suscripcion }) {
  const [periodos, setPeriodos] = useState(1);
  const unidad = suscripcion.ciclo === 'ANUAL' ? 'año' : 'mes';

  return (
    <AccionModal
      disparador={
        <Button size="sm">
          <RefreshCw /> Renovar
        </Button>
      }
      titulo={`Renovar ${suscripcion.comercio.nombre}`}
      descripcion={
        suscripcion.dias_restantes >= 0
          ? 'El nuevo vencimiento se cuenta desde el actual, así no se pierden los días que faltan.'
          : 'Como ya venció, el período nuevo arranca hoy: no se cobra el tiempo que el comercio no usó.'
      }
      accion={renovarSuscripcion}
      textoGuardar="Renovar"
    >
      <input type="hidden" name="id" value={suscripcion.id} />

      <Field label={`Períodos a renovar (${unidad}es)`} htmlFor="periodos">
        <Input
          id="periodos"
          name="periodos"
          type="number"
          min={1}
          max={24}
          value={periodos}
          onChange={(evento) => setPeriodos(Math.max(1, Number(evento.target.value) || 1))}
        />
      </Field>

      <CamposCobro sugerido={suscripcion.precio_pactado * periodos} />
    </AccionModal>
  );
}

export function CambiarEstado({ suscripcion }: { suscripcion: Suscripcion }) {
  if (suscripcion.estado === 'CANCELADA') {
    return (
      <BotonAccion variant="outline" size="sm" accion={() => reactivarSuscripcion(suscripcion.id)}>
        Reactivar
      </BotonAccion>
    );
  }

  return (
    <BotonAccion
      variant="ghost"
      size="sm"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      accion={() => cancelarSuscripcion(suscripcion.id)}
      confirmacion="Confirmar baja"
    >
      Cancelar
    </BotonAccion>
  );
}
