/**
 * El fallo del OCR de facturas no filtra el detalle interno: sale un mensaje
 * fijo con 500, sin el texto crudo del error.
 *
 * Corre aparte de `pruebas/correr.ts` porque necesita reemplazar el modulo de
 * Prisma (`mock.module`), y para eso Node exige el flag
 * `--experimental-test-module-mocks`. Ver el script `prueba:factura-ocr`.
 *
 * Por que el mock es del modulo y no del constructor: `procesarFacturaOcr`
 * llama a `validarLicenciaChat` y a los helpers de consumo contra el `prisma`
 * del modulo, no contra `this.db`, asi que la unica costura interceptable es el
 * modulo.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert';

process.env.JWT_SECRET ??= 'secreto-de-pruebas-de-al-menos-32-caracteres';
process.env.JWT_AT_EXPIRY ??= '8h';
process.env.DATABASE_URL ??= 'postgresql://sin-uso';
process.env.ENCRYPTION_KEY ??= 'f1a8c9b2e3d4a5b6c7d8e9f0123456789abcdef0123456789abcdef012345678';
process.env.LLM_API_KEY ??= 'clave-de-pruebas';

const LICENCIA = {
  id: 'lic-1',
  estado: 'activa',
  comercio_id: null,
  clave_hash: 'enc',
  clave_busqueda: 'busq',
};

const PRISMA = {
  licencia: { findUnique: async () => LICENCIA, findMany: async () => [LICENCIA] },
  activacion: { findUnique: async () => ({ id: 'act-1' }) },
  chatConsumo: {
    upsert: async () => ({}),
    updateMany: async () => ({ count: 1 }),
    findUnique: async () => ({ mensajes: 10 }),
  },
  chatConsumoComercio: {
    upsert: async () => ({}),
    updateMany: async () => ({ count: 1 }),
    findUnique: async () => ({ mensajes: 0 }),
  },
};

const MENSAJE_FIJO = 'Error al procesar la imagen de la factura con IA';
const PEDIDO = {
  clave: 'k',
  instalacion_id: 'i',
  imagen_base64: 'abc',
  mime_type: 'image/png',
};

async function correrOcr(): Promise<any> {
  const modulo: any = await import('../src/features/chat/chat.service');
  try {
    await new modulo.ChatService().procesarFacturaOcr(PEDIDO);
  } catch (e) {
    return e;
  }
  throw new Error('procesarFacturaOcr NO lanzo ningun error');
}

test('el catch devuelve el mensaje fijo y no el detalle interno', async () => {
  mock.module('../src/config/prisma', { defaultExport: PRISMA });

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('INTERNO: sk-secret /ruta/privada');
  }) as typeof fetch;

  try {
    const error = await correrOcr();
    assert.equal(error.statusCode, 500);
    assert.equal(error.message, MENSAJE_FIJO);
    assert.ok(!error.message.includes('INTERNO'), error.message);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('un JSON.parse crudo no viaja al cliente', async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'NO-JSON {{ sk-x' } }] }), {
      status: 200,
    })) as typeof fetch;

  try {
    const error = await correrOcr();
    assert.equal(error.statusCode, 500);
    assert.equal(error.message, MENSAJE_FIJO);
    assert.ok(!error.message.includes('NO-JSON'), error.message);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('handleApiError serializa 500 con el mensaje fijo', async () => {
  const { handleApiError } = await import('../src/utils/api-error');

  const salida: any = {};
  const res: any = {
    status(codigo: number) {
      salida.status = codigo;
      return res;
    },
    json(cuerpo: any) {
      salida.cuerpo = cuerpo;
      return res;
    },
  };

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('INTERNO-QUE-NO-DEBE-VIAJAR');
  }) as typeof fetch;

  try {
    handleApiError(await correrOcr(), res, 'Error interno del servidor');
    assert.equal(salida.status, 500);
    assert.equal(salida.cuerpo.message, MENSAJE_FIJO);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});
