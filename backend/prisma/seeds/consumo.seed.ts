import { PrismaClient } from '@prisma/client';
import { LICENCIA_SERVIDOR_SEED_ID } from './licencias.seed';
import { periodoActual } from '../../src/features/comercio/comercio.resumen';

/**
 * Consumo de chat demo del periodo en curso, sobre la clave servidor del
 * comercio completo. Sirve para que el detalle no muestre el consumo en cero.
 */
export async function seedConsumoChat(prisma: PrismaClient) {
  console.log('Sembrando consumo de chat demo...');

  const licencia = await prisma.licencia.findUnique({ where: { id: LICENCIA_SERVIDOR_SEED_ID } });
  if (!licencia) {
    throw new Error('Falta la licencia servidor demo: corré seedLicencias antes que seedConsumoChat.');
  }

  const periodo = periodoActual();
  const data = {
    licencia_id: LICENCIA_SERVIDOR_SEED_ID,
    periodo,
    mensajes: 37,
    prompt_tokens: BigInt(12500),
    completion_tokens: BigInt(4300),
    total_tokens: BigInt(16800),
    cached_tokens: BigInt(2100),
  };

  await prisma.chatConsumo.upsert({
    where: { licencia_id_periodo: { licencia_id: LICENCIA_SERVIDOR_SEED_ID, periodo } },
    create: data,
    update: data,
  });

  console.log(`  1 consumo de chat demo para ${periodo} (37 mensajes).`);
}
