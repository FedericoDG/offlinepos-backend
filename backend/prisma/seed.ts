/**
 * Sembrado de la base de datos.
 *
 * Flujo: PRIMERO deja TODO en blanco (borra cada tabla en orden de
 * dependencias) y DESPUÉS siembra un único administrador
 * (federico@mail.com / 123456).
 *
 * Es destructivo a propósito: correr `npm run db:seed` es empezar de cero.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { seedAdministradores } from './seeds/administradores.seed';
import { exigirPermisoDestructivo } from './guard';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const prisma = new PrismaClient();

/** Vacía todas las tablas. El orden respeta las dependencias (hijos primero). */
async function limpiarTodo(): Promise<void> {
  await prisma.activacion.deleteMany({});
  await prisma.chatConsumo.deleteMany({});
  await prisma.chatConsumoComercio.deleteMany({});
  await prisma.pago.deleteMany({});
  await prisma.licencia.deleteMany({});
  await prisma.suscripcion.deleteMany({});
  await prisma.comercio.deleteMany({});
  await prisma.plan.deleteMany({});
  await prisma.administrador.deleteMany({});
  console.log('Base de datos vaciada por completo.');
}

async function main() {
  // Antes de tocar nada: en producción (o contra una base no local) esto se
  // aborta salvo confirmación explícita. Ver `guard.ts`.
  exigirPermisoDestructivo('seed: vaciar la base y sembrar');

  console.log('-> Sembrado: vaciando la base y sembrando de cero...');

  await limpiarTodo();
  await seedAdministradores(prisma);

  console.log('-> Sembrado completado: base en blanco + 1 administrador.');
}

main()
  .catch((e) => {
    console.error('Error durante el sembrado de la base de datos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
