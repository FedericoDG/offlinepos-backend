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
  /** Token firmado: el escritorio decide el acceso solo con esto, no con su SQLite. */
  token: string;
  licencia: {
    id: string;
    /** Siempre 'SERVIDOR': el tipo cliente ya no existe. */
    rol: 'SERVIDOR';
    estado: string;
    activado_en: Date | null;
    max_activaciones_restantes: number;
    comercio: {
      id: string;
      nombre: string;
    };
  };
}

/**
 * Alta de licencias desde el panel.
 *
 * Con `comercio_id` se emite una clave sobre un comercio puntual (camino viejo,
 * con validacion de cupo). Sin `comercio_id` se generan `cantidad` claves
 * sueltas —"libres"— que todavia no pertenecen a nadie y se asignan despues al
 * dar de alta un comercio. El cupo se controla al asignar, no al generar.
 *
 * Ya no se acepta `rol`: toda licencia es SERVIDOR. El unico tipo que queda.
 * Es `strict` a proposito: un `rol` de tipo cliente viejo tiene que fallar con
 * 400 en vez de colarse silenciosamente y emitir una clave servidor.
 */
export const CrearLicenciaDTO = z
  .object({
    comercio_id: z
      .string({ message: 'El comercio debe ser una cadena de texto' })
      .trim()
      .min(1, 'El comercio no puede ser vacío')
      .optional(),
    cantidad: z
      .number({ message: 'cantidad debe ser un número entero' })
      .int()
      .positive('cantidad debe ser mayor a 0')
      .max(50, 'cantidad no puede superar 50')
      .default(1),
    max_activaciones: z
      .number({ message: 'max_activaciones debe ser un número entero' })
      .int()
      .positive('max_activaciones debe ser mayor a 0')
      .max(1000, 'max_activaciones no puede superar 1000')
      .default(1),
    clave: z
      .string({ message: 'La clave debe ser una cadena de texto' })
      .trim()
      .min(6, 'La clave debe tener al menos 6 caracteres')
      .optional(),
  })
  .strict();

export type CrearLicenciaDTO = z.infer<typeof CrearLicenciaDTO>;

export interface CrearLicenciaResponseDTO {
  message: string;
  licencia: {
    id: string;
    clave: string;
    /** Siempre 'SERVIDOR': el tipo cliente ya no existe. */
    rol: 'SERVIDOR';
    estado: string;
    max_activaciones: number;
    comercio: {
      id: string;
      nombre: string;
    };
  };
}

/** Una clave libre recien generada, con su texto plano para entregar. */
export interface ClaveGeneradaDTO {
  id: string;
  clave: string;
  /** Siempre 'SERVIDOR': el tipo cliente ya no existe. */
  rol: 'SERVIDOR';
  estado: string;
  max_activaciones: number;
}

export interface GenerarClavesResponseDTO {
  message: string;
  licencias: ClaveGeneradaDTO[];
}
