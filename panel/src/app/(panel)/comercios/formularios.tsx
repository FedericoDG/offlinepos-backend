'use client';

import { Pencil, Plus } from 'lucide-react';
import { crearComercio, eliminarComercio, renombrarComercio } from '@/actions/comercios';
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
