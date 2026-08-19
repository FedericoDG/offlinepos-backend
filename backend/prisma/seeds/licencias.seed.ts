import { PrismaClient } from '@prisma/client';
import { encrypt } from '../../src/utils/encryption';
import { COMERCIO_SEED_ID } from './comercios.seed';

export const LICENCIA_SEED_ID = 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e';
export const CLAVE_LICENCIA_RAW = 'LIC-2026-POS-DEMO-KEY';

export async function seedLicencias(prisma: PrismaClient) {
  console.log('Creando licencias...');

  const claveCifrada = encrypt(CLAVE_LICENCIA_RAW);

  const licencias = await prisma.licencia.createMany({
    data: [
      {
        id: LICENCIA_SEED_ID,
        comercio_id: COMERCIO_SEED_ID,
        clave_hash: claveCifrada,
        estado: 'activa',
        activado_en: new Date(),
        max_activaciones: 3,
      },
    ],
  });

  return licencias;
}
