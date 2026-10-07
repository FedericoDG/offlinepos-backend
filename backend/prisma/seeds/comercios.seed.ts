import { PrismaClient } from '@prisma/client';

/**
 * Comercios demo. Ids deterministas ('demo-comercio-N') para que el upsert sea
 * idempotente y la pantalla de detalle se pueda pedir por id fijo.
 *
 * Los tres cubren los caminos que importan:
 *   1) completo  -> plan + telefono + email
 *   2) solo plan -> sin contacto (ejercita los campos opcionales)
 *   3) legacy    -> sin plan directo (camino viejo por Suscripcion)
 */
export const COMERCIO_DEMO_1_ID = 'demo-comercio-1';
export const COMERCIO_DEMO_2_ID = 'demo-comercio-2';
export const COMERCIO_DEMO_3_ID = 'demo-comercio-3';

// Alias historico: la clave servidor/cliente demo y el "Comercio Central POS"
// apuntan al primer comercio.
export const COMERCIO_SEED_ID = COMERCIO_DEMO_1_ID;

/** Alta retroactiva de los demos sin pagos, para que su deuda estimada no sea 0. */
function mesesAtras(meses: number): Date {
  const fecha = new Date();
  fecha.setUTCMonth(fecha.getUTCMonth() - meses);
  return fecha;
}

export async function seedComercios(prisma: PrismaClient) {
  console.log('Sembrando comercios demo...');

  const planPro = await prisma.plan.findUnique({ where: { codigo: 'PRO' } });
  const planBasico = await prisma.plan.findUnique({ where: { codigo: 'BASICO' } });

  if (!planPro || !planBasico) {
    throw new Error('Faltan los planes demo: corré seedPlanes antes que seedComercios.');
  }

  // 1) Completo: plan + telefono + email.
  await prisma.comercio.upsert({
    where: { id: COMERCIO_DEMO_1_ID },
    create: {
      id: COMERCIO_DEMO_1_ID,
      nombre: 'Comercio Central POS',
      telefono: '+54 11 5555-0001',
      email: 'central@demo.local',
      plan_id: planPro.id,
    },
    update: {
      nombre: 'Comercio Central POS',
      telefono: '+54 11 5555-0001',
      email: 'central@demo.local',
      plan_id: planPro.id,
    },
  });

  // 2) Solo plan: sin telefono ni email. Alta de hace dos meses y sin pagos,
  //    asi la deuda estimada queda en 2 periodos.
  await prisma.comercio.upsert({
    where: { id: COMERCIO_DEMO_2_ID },
    create: {
      id: COMERCIO_DEMO_2_ID,
      nombre: 'Almacén Sin Contacto',
      plan_id: planBasico.id,
      createdAt: mesesAtras(2),
    },
    update: {
      nombre: 'Almacén Sin Contacto',
      telefono: null,
      email: null,
      plan_id: planBasico.id,
      createdAt: mesesAtras(2),
    },
  });

  // 3) Legacy: sin plan directo. Vive del camino viejo por Suscripcion.
  await prisma.comercio.upsert({
    where: { id: COMERCIO_DEMO_3_ID },
    create: {
      id: COMERCIO_DEMO_3_ID,
      nombre: 'Kiosco Legacy',
      createdAt: mesesAtras(4),
    },
    update: {
      nombre: 'Kiosco Legacy',
      telefono: null,
      email: null,
      plan_id: null,
      createdAt: mesesAtras(4),
    },
  });

  console.log('  3 comercios demo listos.');
}
