import { z } from 'zod';
export const loginSchema = z.object({
    email: z.string().email('Formato de email inválido'),
    password: z.string().min(1, 'La contraseña es obligatoria'),
});
