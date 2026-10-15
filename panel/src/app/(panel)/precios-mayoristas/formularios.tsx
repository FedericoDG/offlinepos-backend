'use client';

import { useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  eliminarCadena,
  importarDumpMayorista,
  vaciarCadenas,
} from '@/actions/precios-mayoristas';
import { AccionModal } from '@/components/ui/accion-modal';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * Importa los precios de un mayorista desde el ZIP que publica SEPA.
 *
 * Se sube a mano cada vez que el mayorista actualiza (típicamente a diario):
 * el backend hace upsert, así que subir el mismo ZIP dos veces no duplica nada.
 */
export function ImportarDump() {
  const [bytes, setBytes] = useState<number | null>(null);

  return (
    <AccionModal
      disparador={
        <Button>
          <Upload /> Importar ZIP de SEPA
        </Button>
      }
      titulo="Importar precios de un mayorista"
      descripcion="Subí el .zip que publica el mayorista. Adentro trae tres archivos (comercio, sucursales y productos); se cargan los precios del día."
      accion={importarDumpMayorista}
      textoGuardar="Importar"
      ancho="sm:max-w-lg"
    >
      <FieldGroup>
        <Field
          label="Archivo del mayorista"
          description="El .zip de SEPA con los tres CSV adentro. La importación tarda unos segundos."
        >
          <Input
            name="archivo"
            type="file"
            accept=".zip,application/zip"
            required
            onChange={(e) => setBytes(e.target.files?.[0]?.size ?? null)}
          />
        </Field>

        {bytes !== null && bytes > 0 && (
          <p className="text-xs text-muted-foreground">
            {(bytes / 1024 / 1024).toFixed(1)} MB
          </p>
        )}
      </FieldGroup>
    </AccionModal>
  );
}

/** Borra una cadena completa (sus precios y sucursales) de la base. */
export function EliminarCadena({
  id,
  nombre,
  productos,
}: {
  id: string;
  nombre: string;
  productos: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [borrando, setBorrando] = useState(false);

  async function confirmar() {
    setBorrando(true);
    try {
      const r = await eliminarCadena(id);
      if (r.ok) {
        toast.success(r.mensaje ?? `${nombre} eliminada`);
        setAbierto(false);
      } else {
        toast.error(r.error ?? 'No se pudo eliminar');
      }
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          title={`Eliminar ${nombre} por completo`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Eliminar {nombre}?</DialogTitle>
          <DialogDescription>
            Se borran sus {productos.toLocaleString('es-AR')} precios y sus sucursales de la base.
            No se puede deshacer. Para volver a tenerlos, subí de nuevo el ZIP del mayorista.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirmar} disabled={borrando}>
            {borrando ? 'Eliminando…' : 'Sí, eliminar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Vacía la sección entera: borra TODAS las cadenas con sus precios.
 * Para cuando hay que empezar de cero (por ejemplo, después de una carga
 * masiva equivocada).
 */
export function VaciarTodo({
  cadenas,
  productos,
}: {
  cadenas: number;
  productos: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const [borrando, setBorrando] = useState(false);

  async function confirmar() {
    setBorrando(true);
    try {
      const r = await vaciarCadenas();
      if (r.ok) {
        toast.success(r.mensaje ?? 'Se borraron todas las cadenas');
        setAbierto(false);
      } else {
        toast.error(r.error ?? 'No se pudieron borrar');
      }
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-destructive hover:text-destructive">
          <Trash2 /> Vaciar todo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Borrar todas las cadenas?</DialogTitle>
          <DialogDescription>
            Se borran las {cadenas} cadenas cargadas con sus {productos.toLocaleString('es-AR')}{' '}
            precios y sus sucursales. Los comerciantes dejan de poder consultar precios
            mayoristas hasta que vuelvas a subir los ZIP. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={confirmar} disabled={borrando}>
            {borrando ? 'Borrando…' : 'Sí, borrar todo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
