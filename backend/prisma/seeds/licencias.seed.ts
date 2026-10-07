import { PrismaClient, RolLicencia } from '@prisma/client';
import { encrypt, hmacBusqueda } from '../../src/utils/encryption';
import { COMERCIO_DEMO_1_ID } from './comercios.seed';

/**
 * Licencias demo. Se guardan las DOS columnas que usa el servicio: `clave_hash`
 * (AES, reversible para poder mostrar la clave) y `clave_busqueda` (HMAC, indice
 * unico para el lookup O(1) de activacion). Saltear el HMAC deja la clave
 * invisible para el camino rapido.
 *
 * Las claves son FIJAS a proposito: si se generaran al azar, cada corrida del
 * seed invalidaria la clave que alguien ya tiene anotada. Formato actual: tres
 * grupos de cuatro, alfabeto sin caracteres ambiguos (sin I, O, 0, 1).
 */
export const LICENCIA_LIBRE_SEED_ID = 'demo-licencia-libre';
export const LICENCIA_SERVIDOR_SEED_ID = 'demo-licencia-servidor';

export const CLAVE_LICENCIA_LIBRE_RAW = 'K7M2-Q9LP-4XZR';
export const CLAVE_LICENCIA_SERVIDOR_RAW = 'B4TN-7QWM-2XKP';

// Aliases historicos para imports existentes.
export const LICENCIA_SEED_ID = LICENCIA_SERVIDOR_SEED_ID;
export const CLAVE_LICENCIA_RAW = CLAVE_LICENCIA_SERVIDOR_RAW;

function datosLicencia(
  clave: string,
  comercioId: string | null,
  rol: RolLicencia,
  maxActivaciones: number
) {
  return {
    comercio_id: comercioId,
    clave_hash: encrypt(clave),
    clave_busqueda: hmacBusqueda(clave),
    rol,
    estado: 'activa',
    activado_en: comercioId ? new Date() : null,
    max_activaciones: maxActivaciones,
  };
}

export async function seedLicencias(prisma: PrismaClient) {
  console.log('Sembrando licencias demo...');

  const definiciones = [
    // Clave suelta (comercio null): existe pero no es activable hasta asignarla.
    { id: LICENCIA_LIBRE_SEED_ID, clave: CLAVE_LICENCIA_LIBRE_RAW, comercio_id: null, rol: RolLicencia.SERVIDOR, max: 1 },
    { id: LICENCIA_SERVIDOR_SEED_ID, clave: CLAVE_LICENCIA_SERVIDOR_RAW, comercio_id: COMERCIO_DEMO_1_ID, rol: RolLicencia.SERVIDOR, max: 3 },
  ];

  for (const def of definiciones) {
    const data = datosLicencia(def.clave, def.comercio_id, def.rol, def.max);
    await prisma.licencia.upsert({
      where: { id: def.id },
      create: { id: def.id, ...data },
      update: data,
    });
  }

  console.log('  Claves demo:');
  console.log(`    Libre    : ${CLAVE_LICENCIA_LIBRE_RAW} (sin comercio)`);
  console.log(`    Servidor : ${CLAVE_LICENCIA_SERVIDOR_RAW} (${COMERCIO_DEMO_1_ID})`);
}
