import { z } from 'zod';
import { Rol } from '@prisma/client';

export const LoginDTO = z.object({
  email: z
    .string({ message: 'El email debe ser una cadena de texto' })
    .trim()
    .toLowerCase()
    .email('El formato del email no es válido'),
  password: z
    .string({ message: 'La contraseña debe ser una cadena de texto' })
    .min(1, 'La contraseña es obligatoria y no puede estar vacía'),
});

export type LoginDTO = z.infer<typeof LoginDTO>;

/** Minimo de contrasena compartido por alta y reseteo. */
const PASSWORD_MIN = 8;
const PASSWORD_MSG = `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;

export const CrearAdministradorDTO = z.object({
  email: z
    .string({ message: 'El email debe ser una cadena de texto' })
    .trim()
    .toLowerCase()
    .email('El formato del email no es válido'),
  password: z
    .string({ message: 'La contraseña debe ser una cadena de texto' })
    .min(PASSWORD_MIN, PASSWORD_MSG),
  rol: z.nativeEnum(Rol).default(Rol.ADMINISTRADOR),
});

export type CrearAdministradorDTO = z.infer<typeof CrearAdministradorDTO>;

/** El email solo cambia si viene; `activo` cae bajo los mismos guardias que el PATCH. */
export const ActualizarAdministradorDTO = z
  .object({
    email: z
      .string({ message: 'El email debe ser una cadena de texto' })
      .trim()
      .toLowerCase()
      .email('El formato del email no es válido'),
    rol: z.nativeEnum(Rol),
    activo: z.boolean(),
  })
  .partial();

export type ActualizarAdministradorDTO = z.infer<typeof ActualizarAdministradorDTO>;

export const ResetPasswordDTO = z.object({
  password: z
    .string({ message: 'La contraseña debe ser una cadena de texto' })
    .min(PASSWORD_MIN, PASSWORD_MSG),
});

export type ResetPasswordDTO = z.infer<typeof ResetPasswordDTO>;

export const CambiarActivoDTO = z.object({
  activo: z.boolean({ message: 'activo debe ser un booleano' }),
});

export type CambiarActivoDTO = z.infer<typeof CambiarActivoDTO>;

/** Forma publica del administrador: jamas incluye el hash de la contrasena. */
export interface AdministradorDTO {
  id: string;
  email: string;
  rol: Rol;
  activo: boolean;
  createdAt: Date;
}

export const LoginResponseDTO = z.object({
  token: z.string(),
  administrador: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    rol: z.nativeEnum(Rol),
  }),
});

export type LoginResponseDTO = z.infer<typeof LoginResponseDTO>;
