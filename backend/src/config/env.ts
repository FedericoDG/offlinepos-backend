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
  // Modelo mayor opcional para análisis profundos (Fase 1: router de modelo).
  // Si no se define, todo usa LLM_MODEL y el router no cambia nada.
  LLM_MODEL_PRO: z.string().min(1).optional(),
  LLM_VISION_MODEL: z.string().default('qwen-vl-plus'),
  LLM_ENABLE_THINKING: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  CHAT_MENSAJES_MES: z.coerce.number().int().positive().default(400),
  CHAT_MENSAJES_POR_OCR: z.coerce.number().int().positive().default(10),
  // Clave privada Ed25519 (PEM) para firmar tokens de licencia. Opcional en dev
  // (se usa un par efímero); en producción sin esta clave, activar licencia falla.
  LICENCIA_SIGN_PRIV_KEY: z.string().min(1).optional(),
  // URL pública del backend (dominio ngrok en producción): las descargas del
  // updater llevan URLs absolutas y detrás de un túnel el host local no sirve.
  // Debe ser SOLO el origen: el código ya agrega "/api/...". Si viniera con un
  // path (ej. /api-pos-offline), las URLs saldrían con doble /api; abajo se
  // normaliza con un aviso en vez de no arrancar (un error de config no debe
  // tumbar el backend en producción).
  PUBLIC_BASE_URL: z
    .string()
    .url('PUBLIC_BASE_URL debe ser una URL válida')
    .default('http://localhost:4000'),
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

/**
 * PUBLIC_BASE_URL es SOLO el origen (sin path): el código arma las URLs
 * absolutas como `{PUBLIC_BASE_URL}/api/...`. Si alguien le configura un
 * prefijo (p. ej. `/api-pos-offline`), saldrían con doble `/api` y romperían
 * el updater y el link móvil. Se normaliza acá con un aviso fuerte: preferimos
 * arrancar y avisar antes que dejar el backend caído por un env mal puesto.
 */
try {
  const publica = new URL(env.PUBLIC_BASE_URL);
  if (publica.pathname !== '/') {
    console.warn(
      `[Config] PUBLIC_BASE_URL traía path ("${publica.pathname}"): se usa solo el origen "${publica.origin}". ` +
        'Debería ser únicamente el origen (sin /api ni prefijos).',
    );
    env.PUBLIC_BASE_URL = publica.origin;
  }
} catch {
  /* ya validado por zod: si el URL no parsea, el parseo falló antes. */
}
