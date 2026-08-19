import { z } from 'zod';

export const ActivarLicenciaDTO = z.object({
  clave: z
    .string({ message: 'La clave de licencia debe ser una cadena de texto' })
    .trim()
    .min(1, 'La clave de licencia es obligatoria'),
  instalacion_id: z
    .string({ message: 'El identificador de instalación es obligatorio' })
    .trim()
    .min(1, 'El identificador de instalación es obligatorio'),
});

export type ActivarLicenciaDTO = z.infer<typeof ActivarLicenciaDTO>;

export interface ActivarLicenciaResponseDTO {
  message: string;
  reinstalacion: boolean;
  licencia: {
    id: string;
    estado: string;
    activado_en: Date | null;
    max_activaciones_restantes: number;
    comercio: {
      id: string;
      nombre: string;
    };
  };
}
