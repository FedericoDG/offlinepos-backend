import { PrismaClient } from '@prisma/client';
import { COMERCIO_DEMO_1_ID } from './comercios.seed';
import { finDeMes, inicioDeMes } from '../../src/features/comercio/comercio.resumen';

/**
 * Pagos directos demo para el comercio completo. Cubren el mes pasado y el mes
 * en curso: el detalle queda "al dia" (deuda 0) y ademas muestra historial.
 * Los demos sin pagos (demo-comercio-2) son los que exhiben deuda.
 */
export const PAGO_DEMO_1_ID = 'demo-pago-1';
export const PAGO_DEMO_2_ID = 'demo-pago-2';

function periodoDeMesesAtras(meses: number): { desde: Date; hasta: Date } {
  const referencia = new Date();
  referencia.setUTCMonth(referencia.getUTCMonth() - meses);
  return { desde: inicioDeMes(referencia), hasta: finDeMes(referencia) };
}

export async function seedPagos(prisma: PrismaClient) {
  console.log('Sembrando pagos directos demo...');

  const comercio = await prisma.comercio.findUnique({ where: { id: COMERCIO_DEMO_1_ID } });
  if (!comercio) {
    throw new Error('Falta demo-comercio-1: corré seedComercios antes que seedPagos.');
  }

  const definiciones = [
    { id: PAGO_DEMO_1_ID, meses: 1, monto: 28000, nota: 'Pago demo: mes pasado' },
    { id: PAGO_DEMO_2_ID, meses: 0, monto: 28000, nota: 'Pago demo: mes en curso' },
  ];

  for (const def of definiciones) {
    const { desde, hasta } = periodoDeMesesAtras(def.meses);
    const data = {
      comercio_id: COMERCIO_DEMO_1_ID,
      suscripcion_id: null,
      monto: def.monto,
      moneda: 'ARS',
      metodo: 'TRANSFERENCIA' as const,
      pagado_en: hasta,
      periodo_desde: desde,
      periodo_hasta: hasta,
      nota: def.nota,
    };

    await prisma.pago.upsert({
      where: { id: def.id },
      create: { id: def.id, ...data },
      update: data,
    });
  }

  console.log('  2 pagos directos demo (mes pasado y mes en curso).');
}
