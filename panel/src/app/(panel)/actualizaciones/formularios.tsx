'use client';

import { useState } from 'react';
import { Rocket, Trash2 } from 'lucide-react';
import { eliminarVersion, publicarVersion } from '@/actions/actualizaciones';
import { AccionModal } from '@/components/ui/accion-modal';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

/**
 * Publicación manual de una versión del POS: los instaladores se construyen
 * y firman afuera (CI `build-windows.yml` o `release.yml`) y acá se suben
 * ya firmados. El backend los guarda y regenera latest.json, que es lo que
 * consultan los updater de las cajas.
 */
export function PublicarVersion() {
  const [version, setVersion] = useState('');

  const bloqueo = !version
    ? undefined
    : /^\d+\.\d+\.\d+$/.test(version.trim())
      ? undefined
      : 'La versión debe tener formato semver (ej. 0.1.4)';

  return (
    <AccionModal
      disparador={
        <Button>
          <Rocket /> Publicar versión
        </Button>
      }
      titulo="Publicar versión del POS"
      descripcion="Subí los instaladores ya firmados. Al guardar, esta versión pasa a ser la vigente y las cajas la ofrecen al abrir."
      accion={publicarVersion}
      textoGuardar="Publicar"
      bloqueo={bloqueo}
      ancho="sm:max-w-xl"
    >
      <FieldGroup>
        <Field label="Versión" description="Semver. Tiene que ser mayor que la vigente para que el updater la ofrezca.">
          <Input name="version" required placeholder="0.1.4" value={version} onChange={(e) => setVersion(e.target.value)} />
        </Field>

        <Field label="Notas de la versión" description="Lo que ven las cajas en el aviso. Opcional.">
          <Textarea name="notas" rows={3} placeholder="Qué trae esta versión…" />
        </Field>

        <Field label="Instalador NSIS (.exe)" description="El que descarga e instala el updater en Windows. Obligatorio.">
          <Input name="setup" type="file" accept=".exe" required />
        </Field>

        <Field label="Firma del NSIS (.sig)" description="El .sig que genera el build junto al .exe. Obligatorio.">
          <Input name="setupFirma" type="file" accept=".sig" required />
        </Field>

        <Field label="Instalador MSI (opcional)" description="Solo para instalación manual en empresas.">
          <Input name="msi" type="file" accept=".msi" />
        </Field>

        <Field label="Firma del MSI (.sig)" description="Obligatoria solo si subís el MSI.">
          <Input name="msiFirma" type="file" accept=".sig" />
        </Field>
      </FieldGroup>
    </AccionModal>
  );
}

/**
 * Elimina una versión completa del disco, con confirmación explícita.
 * Si es la vigente, el texto avisa que también cae latest.json y las cajas
 * dejan de ver actualizaciones hasta la próxima publicación.
 */
export function EliminarVersion({ version, esVigente }: { version: string; esVigente: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [borrando, setBorrando] = useState(false);

  async function confirmar() {
    setBorrando(true);
    try {
      const r = await eliminarVersion(version);
      if (r.ok) {
        toast.success(r.mensaje ?? `Versión ${version} eliminada`);
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
          title={`Eliminar la versión ${version} por completo`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Eliminar la versión {version}?</DialogTitle>
          <DialogDescription>
            Se borra la carpeta completa del disco (instaladores y firmas).
            {esVigente
              ? ' Como es la versión vigente, también se borra latest.json: las cajas dejarán de ver actualizaciones hasta que publiques una nueva.'
              : ' La versión vigente no se toca.'}
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
