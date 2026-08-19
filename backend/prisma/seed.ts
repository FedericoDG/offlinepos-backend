import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { seedAdministradores } from './seeds/administradores.seed';
import { seedComercios } from './seeds/comercios.seed';
import { seedLicencias } from './seeds/licencias.seed';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const prisma = new PrismaClient();

async function cleanupDatabase(prisma: PrismaClient) {
  // Limpiar en orden dependiente (hijos primero)
  await prisma.licencia.deleteMany({});
  await prisma.comercio.deleteMany({});
  await prisma.administrador.deleteMany({});
  console.log('Base de datos limpiada');
}

async function main() {
  console.log('-> Iniciando sembrado de la base de datos...');

  // Limpiar datos existentes primero
  await cleanupDatabase(prisma);

  // Sembrar en orden: padres → hijos (para satisfacer FK)
  await seedAdministradores(prisma);
  await seedComercios(prisma);
  await seedLicencias(prisma);

  console.log('-> Sembrado de la base de datos completado!');
}

main()
  .catch((e) => {
    console.error('Error durante el sembrado de la base de datos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
