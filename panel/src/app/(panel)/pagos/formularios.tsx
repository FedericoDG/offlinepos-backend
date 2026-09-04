'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { eliminarPago, registrarPago } from '@/actions/pagos';
import { AccionModal } from '@/components/ui/accion-modal';
import { BotonAccion } from '@/components/ui/boton-accion';
import { Button } from '@/components/ui/button';
import { Field, FieldRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fechaInput, plata } from '@/lib/formato';
import type { Suscripcion } from '@/lib/tipos';

const METODOS = [
  ['TRANSFERENCIA', 'Transferencia'],
  ['EFECTIVO', 'Efectivo'],
  ['MERCADO_PAGO', 'Mercado Pago'],
  ['TARJETA', 'Tarjeta'],
  ['OTRO', 'Otro'],
] as const;

function sumarMeses(base: Date, meses: number): Date {
  const salida = new Date(base.getTime());
  const dia = salida.getDate();
  salida.setMonth(salida.getMonth() + meses);
  if (salida.getDate() < dia) salida.setDate(0);
  return salida;
}

/**
 * Registrar un pago suelto. Lo normal es cobrar renovando desde Suscripciones;
 * esto es para el caso contrario: la plata que entró sin mover el vencimiento
 * (una deuda vieja, un ajuste, un pago partido).
 */
export function RegistrarPago({ suscripciones }: { suscripciones: Suscripcion[] }) {
  const [elegida, setElegida] = useState('');

  const suscripcion = useMemo(() => suscripciones.find((s) => s.id === elegida), [elegida, suscripciones]);

  const hoy = new Date();
  const periodoDesde = suscripcion ? new Date(suscripcion.vence_en) : hoy;
  const periodoHasta = sumarMeses(periodoDesde, suscripcion?.ciclo === 'ANUAL' ? 12 : 1);

  return (
    <AccionModal
      disparador={
        <Button disabled={suscripciones.length === 0}>
          <Plus /> Registrar pago
        </Button>
      }
      titulo="Registrar pago"
      descripcion="No mueve el vencimiento. Para cobrar y renovar de una, usá Renovar en Suscripciones."
      accion={registrarPago}
      textoGuardar="Registrar"
    >
      <Field label="Suscripción">
        <Select name="suscripcion_id" required value={elegida} onValueChange={setElegida}>
          <SelectTrigger>
            <SelectValue placeholder="Elegí una suscripción" />
          </SelectTrigger>
          <SelectContent>
            {suscripciones.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.comercio.nombre} — {s.plan?.nombre ?? 'sin plan'} ({plata(s.precio_pactado)})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <FieldRow>
        <Field label="Monto" htmlFor="monto">
          <Input
            key={elegida}
            id="monto"
            name="monto"
            type="number"
            min={1}
            step={1}
            defaultValue={suscripcion?.precio_pactado ?? ''}
            required
          />
        </Field>
        <Field label="Fecha del cobro" htmlFor="pagado_en" description="Es la que manda en el gráfico mensual.">
          <Input id="pagado_en" name="pagado_en" type="date" defaultValue={fechaInput(hoy)} />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Período desde" htmlFor="periodo_desde">
          <Input
            key={`d-${elegida}`}
            id="periodo_desde"
            name="periodo_desde"
            type="date"
            defaultValue={fechaInput(periodoDesde)}
            required
          />
        </Field>
        <Field label="Período hasta" htmlFor="periodo_hasta">
          <Input
            key={`h-${elegida}`}
            id="periodo_hasta"
            name="periodo_hasta"
            type="date"
            defaultValue={fechaInput(periodoHasta)}
            required
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label="Método">
          <Select name="metodo" defaultValue="TRANSFERENCIA">
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
        </Field>
        <Field label="Referencia" htmlFor="referencia">
          <Input id="referencia" name="referencia" placeholder="TRF-000123" />
        </Field>
      </FieldRow>

      <Field label="Nota" htmlFor="nota">
        <Textarea id="nota" name="nota" placeholder="Opcional." />
      </Field>
    </AccionModal>
  );
}

export function EliminarPago({ id }: { id: string }) {
  return (
    <BotonAccion
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
      accion={() => eliminarPago(id)}
      confirmacion="Confirmar"
    >
      Eliminar
    </BotonAccion>
  );
}
