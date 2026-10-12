/**
 * Smoke de las valoraciones de Binny contra la base REAL.
 *
 * Ejercita los dos caminos de punta a punta con el código de producción:
 *   1. Escritura: `ChatService.valorar` (valida licencia + guarda).
 *   2. Lectura:  `EstadisticaService.valoraciones` (lo que sirve el panel).
 *
 * Crea un comercio/licencia/activación temporales, corre el flujo, imprime el
 * JSON que devuelve la lectura y LIMPIA TODO lo que creó. Es idempotente.
 *
 * Uso: npx tsx scripts/smoke-valoracion.mts
 */
import prisma from '../src/config/prisma';
import { encrypt, hmacBusqueda } from '../src/utils/encryption';
import { ChatService } from '../src/features/chat/chat.service';
import { EstadisticaService } from '../src/features/estadistica/estadistica.service';

const chatService = new ChatService();
const estadisticaService = new EstadisticaService();

function mesActual(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const sello = Date.now();
  const clave = `SMOKE-${sello}-VALO-RACI`;
  const instalacionId = `smoke-pc-${sello}`;

  const comercio = await prisma.comercio.create({
    data: { nombre: `Smoke Valoración ${sello}` },
  });
  const licencia = await prisma.licencia.create({
    data: {
      comercio_id: comercio.id,
      clave_hash: encrypt(clave),
      clave_busqueda: hmacBusqueda(clave),
      estado: 'activa',
    },
  });
  await prisma.activacion.create({
    data: { licencia_id: licencia.id, instalacion_id: instalacionId },
  });

  try {
    // --- Escritura (el contrato del endpoint POST /api/chat/valoracion) ---
    const base = { clave, instalacion_id: instalacionId, pregunta: '¿Cuánto vendí hoy?', respuesta: 'Hoy vendiste $12.340 en 7 ventas.' };
    const okBien = await chatService.valorar({ ...base, valoracion: 1, fuente: 'agente' });
    const okMal = await chatService.valorar({ ...base, valoracion: -1, respuesta: 'No tengo esa información.', fuente: 'agente' });

    console.log('POST /api/chat/valoracion ->', JSON.stringify(okBien), JSON.stringify(okMal));

    // Diseño nuevo: la 👍 no deja fila (solo suma al contador); la 👎 sí.
    const guardadas = await prisma.chatValoracion.count({ where: { licencia_id: licencia.id } });
    console.log(`Filas de detalle (solo 👎): ${guardadas}`);
    if (guardadas !== 1) throw new Error('La 👍 no debería dejar fila y la 👎 sí');

    const resumen = await prisma.chatValoracionResumen.findUnique({
      where: { comercio_id_periodo: { comercio_id: comercio.id, periodo: mesActual() } },
    });
    console.log('Contador del período ->', JSON.stringify(resumen));
    if (!resumen || resumen.positivas !== 1 || resumen.negativas !== 1) {
      throw new Error('El contador del período no quedó en 👍1/👎1');
    }

    // --- Lectura (lo que sirve GET /api/estadisticas/valoraciones) ---
    const lectura = await estadisticaService.valoraciones({ periodo: mesActual() });
    console.log('\nGET /api/estadisticas/valoraciones ->');
    console.log(JSON.stringify(lectura, null, 2));
  } finally {
    // Limpieza: solo lo que creó este smoke.
    await prisma.chatValoracionResumen.deleteMany({ where: { comercio_id: comercio.id } });
    await prisma.chatValoracion.deleteMany({ where: { licencia_id: licencia.id } });
    await prisma.activacion.deleteMany({ where: { licencia_id: licencia.id } });
    await prisma.licencia.delete({ where: { id: licencia.id } });
    await prisma.comercio.delete({ where: { id: comercio.id } });
    console.log('\nLimpieza lista: no quedó nada del smoke.');
  }
}

main()
  .catch((error) => {
    console.error('Smoke falló:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // Salida explícita: con el logging de queries el pool puede dejar el
    // proceso vivo un rato después de terminar.
    process.exit(process.exitCode ?? 0);
  });
