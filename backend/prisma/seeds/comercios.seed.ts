import { PrismaClient } from '@prisma/client';

export const COMERCIO_SEED_ID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

export async function seedComercios(prisma: PrismaClient) {
  console.log('Creando comercios...');

  const comercios = await prisma.comercio.createMany({
    data: [
      {
        id: COMERCIO_SEED_ID,
        nombre: 'Comercio Central POS',
      },
    ],
  });

  return comercios;
}
