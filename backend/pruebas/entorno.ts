/**
 * Variables minimas para que `config/env.ts` valide al importarse.
 *
 * Va en su propio modulo y se importa primero: en ESM los `import` se evaluan
 * antes que cualquier linea del archivo, asi que asignarlas dentro de
 * `correr.ts` llegaria tarde.
 *
 * Usa `??=`, asi que si tenes un .env de verdad manda el tuyo. Ninguna de
 * estas se usa para conectarse a nada: las pruebas corren contra una base en
 * memoria.
 */
process.env.JWT_SECRET ??= 'secreto-de-pruebas-de-al-menos-32-caracteres';
process.env.JWT_AT_EXPIRY ??= '8h';
process.env.DATABASE_URL ??= 'postgresql://sin-uso';
process.env.ENCRYPTION_KEY ??= 'f1a8c9b2e3d4a5b6c7d8e9f0123456789abcdef0123456789abcdef012345678';
