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
    LLM_BASE_URL: z.string().url('LLM_BASE_URL debe ser una URL válida').default('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
    LLM_API_KEY: z.string().min(1, 'LLM_API_KEY es obligatoria para el chat con IA'),
    LLM_MODEL: z.string().min(1, 'LLM_MODEL es obligatorio').default('qwen3.7-flash'),
    LLM_ENABLE_THINKING: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
    CHAT_MENSAJES_MES: z.coerce.number().int().positive().default(500),
    // Clave privada Ed25519 (PEM) para firmar tokens de licencia. Opcional en dev
    // (se usa un par efímero); en producción sin esta clave, activar licencia falla.
    LICENCIA_SIGN_PRIV_KEY: z.string().min(1).optional(),
    // URL pública del backend (dominio ngrok en producción): las descargas del
    // updater llevan URLs absolutas y detrás de un túnel el host local no sirve.
    PUBLIC_BASE_URL: z.string().url('PUBLIC_BASE_URL debe ser una URL válida').default('http://localhost:4000'),
    // Secreto para el índice determinista de claves (clave_busqueda). Por defecto
    // usa ENCRYPTION_KEY: siempre estable, evita requerir otro secret.
    LOOKUP_SECRET: z.string().min(1).optional(),
});
const _env = envSchema.safeParse(process.env);
if (!_env.success) {
    console.error('[Config Error]: Variables de entorno inválidas o faltantes:', _env.error.format());
    throw new Error(`[Config Error]: Error en validación de variables de entorno.`);
}
export const env = _env.data;
