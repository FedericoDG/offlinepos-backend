import { PrismaClient, RolLicencia } from '@prisma/client';
import { encrypt } from '../../src/utils/encryption';
import { COMERCIO_SEED_ID } from './comercios.seed';

export const LICENCIA_SERVIDOR_SEED_ID = 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e';
export const LICENCIA_CLIENTE_SEED_ID = 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f';

export const CLAVE_LICENCIA_SERVIDOR_RAW = 'LIC-2026-POS-DEMO-KEY';
export const CLAVE_LICENCIA_CLIENTE_RAW = 'LIC-2026-CLI-DEMO-KEY';

// Aliases para compatibilidad con imports existentes
export const LICENCIA_SEED_ID = LICENCIA_SERVIDOR_SEED_ID;
export const CLAVE_LICENCIA_RAW = CLAVE_LICENCIA_SERVIDOR_RAW;

export async function seedLicencias(prisma: PrismaClient) {
  console.log('Creando licencias...');

  const claveServidorCifrada = encrypt(CLAVE_LICENCIA_SERVIDOR_RAW);
  const claveClienteCifrada = encrypt(CLAVE_LICENCIA_CLIENTE_RAW);

  const licencias = await prisma.licencia.createMany({
    data: [
      {
        id: LICENCIA_SERVIDOR_SEED_ID,
        comercio_id: COMERCIO_SEED_ID,
        clave_hash: claveServidorCifrada,
        rol: RolLicencia.SERVIDOR,
        estado: 'activa',
        activado_en: new Date(),
        max_activaciones: 3,
      },
      {
        id: LICENCIA_CLIENTE_SEED_ID,
        comercio_id: COMERCIO_SEED_ID,
        clave_hash: claveClienteCifrada,
        rol: RolLicencia.CLIENTE,
        estado: 'activa',
        activado_en: new Date(),
        max_activaciones: 5,
      },
    ],
  });

  console.log(`Claves demo disponibles:`);
  console.log(`  Servidor: ${CLAVE_LICENCIA_SERVIDOR_RAW}`);
  console.log(`  Cliente : ${CLAVE_LICENCIA_CLIENTE_RAW}`);

  return licencias;
}