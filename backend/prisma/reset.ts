/**
 * `npm run db:reset` con guarda.
 *
 * `prisma migrate reset --force` borra TODO el schema y lo vuelve a crear sin
 * preguntar. Acá lo envolvemos con la misma guarda que el seed: en producción
 * (o contra una base no local) se aborta salvo confirmación explícita.
 *
 * Uso normal en desarrollo (base local):  npm run db:reset
 * Uso forzado y explícito:
 *   SEED_FORCE=1 SEED_CONFIRM=<nombre de la base> npm run db:reset
 */
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { exigirPermisoDestructivo } from './guard';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

exigirPermisoDestructivo('reset: borrar el schema y re-aplicar migraciones');

const resultado = spawnSync('npx', ['prisma', 'migrate', 'reset', '--force'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(resultado.status ?? 1);
