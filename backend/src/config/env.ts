import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga el .env ubicado en backend_panel_administracion/.env (fuera de backend)
const rootEnvPath = path.resolve(__dirname, '../../../.env');

dotenv.config({ path: rootEnvPath });

// Fallback por si también existe un .env local en backend/
dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET es obligatorio'),
  JWT_AT_EXPIRY: z.string().min(1, 'JWT_AT_EXPIRY es obligatorio'),
  ENCRYPTION_KEY: z
    .string()
    .min(32, 'ENCRYPTION_KEY debe tener al menos 32 caracteres para AES-256')
    .default('f1a8c9b2e3d4a5b6c7d8e9f0123456789abcdef0123456789abcdef012345678'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),
  CORS_ORIGIN: z.string().default('*'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('[Config Error]: Variables de entorno inválidas o faltantes:', _env.error.format());
  throw new Error(`[Config Error]: Error en validación de variables de entorno.`);
}

export const env = _env.data;
