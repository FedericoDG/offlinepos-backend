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

export const LoginResponseDTO = z.object({
  token: z.string(),
  administrador: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    rol: z.nativeEnum(Rol),
  }),
});

export type LoginResponseDTO = z.infer<typeof LoginResponseDTO>;
