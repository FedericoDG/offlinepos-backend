'use client';

import { Banknote, Power, PowerOff, Trash2 } from 'lucide-react';
import { cambiarEstadoLicencia, eliminarLicencia } from '@/actions/licencias';
import { eliminarPago, registrarPagoComercio } from '@/actions/comercios';
import { AccionModal } from '@/components/ui/accion-modal';
import { BotonAccion } from '@/components/ui/boton-accion';
import { Button } from '@/components/ui/button';
import { Field, FieldRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fechaInput } from '@/lib/formato';
import type { ComercioDetalleClave, MetodoPago } from '@/lib/tipos';

/** Métodos de pago con su etiqueta legible; el value es el enum del backend. */
const METODOS: { valor: MetodoPago; etiqueta: string }[] = [
  { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
  { valor: 'MERCADO_PAGO', etiqueta: 'Mercado Pago' },
  { valor: 'TARJETA', etiqueta: 'Tarjeta' },
  { valor: 'OTRO', etiqueta: 'Otro' },
];

/** Primer día del mes local de una fecha. */
function primerDia(fecha: Date): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
}

/** Último día del mes local de una fecha. */
function ultimoDia(fecha: Date): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);
}

/**
 * Acciones de fila de las claves del detalle. Reusan los endpoints de Claves,
 * pero además refrescan esta pantalla: por eso viaja el `comercioId`.
 */
export function AccionesClaveDetalle({
  clave,
  comercioId,
}: {
  clave: ComercioDetalleClave;
  comercioId: string;
}) {
  const activa = clave.estado === 'activa';

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <BotonAccion
        variant="ghost"
        size="sm"
        accion={() => cambiarEstadoLicencia(clave.id, activa ? 'suspendida' : 'activa', comercioId)}
        confirmacion={activa ? 'Confirmar' : undefined}
      >
        {activa ? <PowerOff /> : <Power />}
        {activa ? 'Desactivar' : 'Activar'}
      </BotonAccion>
      <BotonAccion
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        accion={() => eliminarLicencia(clave.id, comercioId)}
        confirmacion="Confirmar"
      >
        <Trash2 /> Borrar
      </BotonAccion>
    </div>
  );
}

/**
 * Registra un pago directo del comercio. Prellena el monto con el precio del
 * plan y el período con el mes siguiente al último cubierto, que es lo que se
 * cobra en el caso normal; todo queda editable.
 */
export function RegistrarPago({
  comercioId,
  precioMensual,
  ultimoPeriodoHasta,
}: {
  comercioId: string;
  precioMensual: number | null;
  ultimoPeriodoHasta: string | null;
}) {
  // El período arranca donde terminó el último pago; si nunca pagó, el mes en curso.
  const base = ultimoPeriodoHasta ? new Date(ultimoPeriodoHasta) : new Date();
  const desde = ultimoPeriodoHasta ? new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1) : primerDia(base);
  const hasta = ultimoPeriodoHasta
    ? new Date(desde.getFullYear(), desde.getMonth() + 1, 0)
    : ultimoDia(base);

  return (
    <AccionModal
      disparador={
        <Button>
          <Banknote /> Registrar pago
        </Button>
      }
      titulo="Registrar pago"
      descripcion="Pago directo del comercio. El monto puede ser parcial; el período define qué mes queda cubierto."
      accion={registrarPagoComercio}
      textoGuardar="Registrar pago"
    >
      <input type="hidden" name="comercio_id" value={comercioId} />

      <FieldRow>
        <Field label="Monto (ARS)" htmlFor="monto">
          <Input
            id="monto"
            name="monto"
            type="number"
            min={1}
            step={1}
            defaultValue={precioMensual ?? ''}
            placeholder="0"
            required
          />
        </Field>
        <Field label="Método" htmlFor="metodo">
          <Select name="metodo" defaultValue="TRANSFERENCIA">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METODOS.map((metodo) => (
                <SelectItem key={metodo.valor} value={metodo.valor}>
                  {metodo.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldRow>

      <Field label="Fecha del pago" htmlFor="pagado_en">
        <Input id="pagado_en" name="pagado_en" type="date" defaultValue={fechaInput(new Date())} />
      </Field>

      <FieldRow>
        <Field label="Período desde" htmlFor="periodo_desde">
          <Input id="periodo_desde" name="periodo_desde" type="date" defaultValue={fechaInput(desde)} />
        </Field>
        <Field label="Período hasta" htmlFor="periodo_hasta" description="Define hasta qué mes queda cubierto.">
          <Input id="periodo_hasta" name="periodo_hasta" type="date" defaultValue={fechaInput(hasta)} />
        </Field>
      </FieldRow>

      <Field label="Nota" htmlFor="nota" description="Opcional. Ej: pago parcial, transferencia nro 1234.">
        <Textarea id="nota" name="nota" maxLength={500} rows={2} />
      </Field>
    </AccionModal>
  );
}

/** Borra un pago directo. Los pagos de suscripción viejos los rechaza el backend (409). */
export function BorrarPago({ pagoId, comercioId }: { pagoId: string; comercioId: string }) {
  return (
    <BotonAccion
      variant="ghost"
      size="sm"
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      accion={() => eliminarPago(pagoId, comercioId)}
      confirmacion="Confirmar"
    >
      <Trash2 /> Borrar
    </BotonAccion>
  );
}
