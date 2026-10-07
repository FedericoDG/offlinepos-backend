import { PrismaClient } from '@prisma/client';

/**
 * Catalogo de planes demo. Precios en ARS, coherentes con lo que ofrece cada
 * cupo. Se hace upsert por `codigo` (unico): correrlo dos veces no duplica.
 */
export const PLANES_DEMO = [
  {
    codigo: 'BASICO',
    nombre: 'Básico',
    descripcion: 'Un servidor, sin terminales extra.',
    precio_mensual: 15000,
    precio_anual: 150000,
    max_servidores: 1,
    max_clientes: 0,
    chat_mensajes_mes: 400,
  },
  {
    codigo: 'PRO',
    nombre: 'Pro',
    descripcion: 'Un servidor y hasta dos terminales.',
    precio_mensual: 28000,
    precio_anual: 280000,
    max_servidores: 1,
    max_clientes: 2,
    chat_mensajes_mes: 1500,
  },
  {
    codigo: 'EMPRENDEDOR',
    nombre: 'Emprendedor',
    descripcion: 'Dos servidores y hasta cuatro terminales.',
    precio_mensual: 45000,
    precio_anual: 450000,
    max_servidores: 2,
    max_clientes: 4,
    chat_mensajes_mes: 5000,
  },
] as const;

export async function seedPlanes(prisma: PrismaClient) {
  console.log('Sembrando planes...');

  for (const plan of PLANES_DEMO) {
    await prisma.plan.upsert({
      where: { codigo: plan.codigo },
      create: { ...plan, moneda: 'ARS', activo: true },
      update: { ...plan, moneda: 'ARS', activo: true },
    });
  }

  console.log(`  ${PLANES_DEMO.length} planes listos: ${PLANES_DEMO.map((p) => p.codigo).join(', ')}`);
}
