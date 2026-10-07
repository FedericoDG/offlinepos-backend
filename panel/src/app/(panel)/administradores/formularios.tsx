'use client';

import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  actualizarAdministrador,
  alternarActivoAdministrador,
  crearAdministrador,
  eliminarAdministrador,
  resetearPasswordAdministrador,
} from '@/actions/administradores';
import { AccionModal } from '@/components/ui/accion-modal';
import { BotonAccion } from '@/components/ui/boton-accion';
import { Button } from '@/components/ui/button';
import { Field, FieldRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AdministradorListado } from '@/lib/tipos';

/** Contraseña con mostrar/ocultar: se tipea a ciegas y se revisa a un clic. */
function CampoPassword() {
  const [visible, setVisible] = useState(false);

  return (
    <Field label="Contraseña" htmlFor="password" description="Mínimo 8 caracteres.">
      <div className="relative">
        <Input
          id="password"
          name="password"
          type={visible ? 'text' : 'password'}
          minLength={8}
          autoComplete="new-password"
          required
          className="pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
          title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff /> : <Eye />}
          <span className="sr-only">{visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}</span>
        </Button>
      </div>
    </Field>
  );
}

/** Campo de rol. Hoy el enum tiene un solo valor, pero el ABM ya lo expone. */
function CampoRol({ valor }: { valor?: string }) {
  return (
    <Field label="Rol" htmlFor="rol">
      <Select name="rol" defaultValue={valor ?? 'ADMINISTRADOR'}>
        <SelectTrigger id="rol">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ADMINISTRADOR">Administrador</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

export function NuevoAdministrador() {
  return (
    <AccionModal
      disparador={
        <Button>
          <Plus /> Nuevo administrador
        </Button>
      }
      titulo="Nuevo administrador"
      descripcion="Un administrador más del panel. La contraseña se guarda hasheada; no se puede recuperar, solo resetear."
      accion={crearAdministrador}
      textoGuardar="Crear administrador"
    >
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <CampoPassword />
      <CampoRol />
    </AccionModal>
  );
}

export function EditarAdministrador({ administrador }: { administrador: AdministradorListado }) {
  return (
    <AccionModal
      disparador={
        <Button variant="outline" size="sm">
          <Pencil /> Editar
        </Button>
      }
      titulo={`Editar ${administrador.email}`}
      descripcion="La contraseña se cambia desde «Resetear contraseña»."
      accion={actualizarAdministrador}
      textoGuardar="Guardar cambios"
    >
      <input type="hidden" name="id" value={administrador.id} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" defaultValue={administrador.email} required />
      </Field>
      <CampoRol valor={administrador.rol} />
    </AccionModal>
  );
}

export function ResetearPassword({ administrador }: { administrador: AdministradorListado }) {
  return (
    <AccionModal
      disparador={
        <Button variant="outline" size="sm">
          <KeyRound /> Resetear contraseña
        </Button>
      }
      titulo={`Resetear contraseña de ${administrador.email}`}
      descripcion="La contraseña anterior deja de funcionar en el próximo inicio de sesión."
      accion={resetearPasswordAdministrador}
      textoGuardar="Resetear"
    >
      <input type="hidden" name="id" value={administrador.id} />
      <CampoPassword />
    </AccionModal>
  );
}

/** Acciones de fila. En tu propio usuario, borrar y desactivar quedan bloqueados. */
export function AccionesAdministrador({
  administrador,
  esActual,
}: {
  administrador: AdministradorListado;
  esActual: boolean;
}) {
  const bloqueo = esActual ? 'No podés desactivar ni borrar tu propio usuario' : undefined;

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <EditarAdministrador administrador={administrador} />
      <ResetearPassword administrador={administrador} />
      <BotonAccion
        variant="ghost"
        size="sm"
        disabled={esActual}
        title={bloqueo}
        accion={() => alternarActivoAdministrador(administrador.id, !administrador.activo)}
        confirmacion={administrador.activo ? 'Confirmar' : undefined}
      >
        {administrador.activo ? 'Desactivar' : 'Activar'}
      </BotonAccion>
      <BotonAccion
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={esActual}
        title={bloqueo}
        accion={() => eliminarAdministrador(administrador.id)}
        confirmacion="Confirmar"
      >
        <Trash2 /> Borrar
      </BotonAccion>
    </div>
  );
}
