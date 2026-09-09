import prisma from '../src/config/prisma';
import { decrypt, hmacBusqueda } from '../src/utils/encryption';

async function main() {
  const licencias = await prisma.licencia.findMany({
    where: { clave_busqueda: null },
    select: { id: true, clave_hash: true },
  });

  if (licencias.length === 0) {
    console.log('Backfill: nada que hacer (todas tienen clave_busqueda)');
    return;
  }

  console.log(`Backfill: ${licencias.length} licencias sin índice…`);

  for (const lic of licencias) {
    try {
      const clave = decrypt(lic.clave_hash);
      const hmac = hmacBusqueda(clave);
      await prisma.licencia.update({
        where: { id: lic.id },
        data: { clave_busqueda: hmac },
      });
      console.log(`  ${lic.id}: ok`);
    } catch (e: any) {
      console.warn(`  ${lic.id}: no se pudo descifrar (${e?.message ?? e}) — se salta`);
    }
  }

  console.log('Backfill listo');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
