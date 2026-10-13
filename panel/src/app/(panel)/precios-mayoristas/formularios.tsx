'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { importarDumpMayorista } from '@/actions/precios-mayoristas';
import { AccionModal } from '@/components/ui/accion-modal';
import { Button } from '@/components/ui/button';
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
