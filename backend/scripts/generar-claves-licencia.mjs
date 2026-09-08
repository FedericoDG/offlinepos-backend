#!/usr/bin/env node
/**
 * Genera el par de claves Ed25519 para firmar tokens de licencia.
 *
 * Uso: node scripts/generar-claves-licencia.mjs
 *
 * Salida:
 *  - LICENCIA_SIGN_PRIV_KEY (PEM, con \n escapados): va al .env del BACKEND de producción.
 *  - LICENCIA_SIGN_PUB_KEY (base64 de los 32 bytes crudos): se compila dentro del binario
 *    desktop (sistema_desktop/.env) al momento de la release.
 *
 * IMPORTANTE: la privada es el secreto raíz del licenciamiento. Si se filtra,
 * cualquiera puede firmar tokens válidos → hay que rotar el par y re-releascar el binario.
 */
import crypto from 'crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);

console.log('LICENCIA_SIGN_PRIV_KEY (backend .env de produccion):');
console.log(JSON.stringify(privPem));
console.log('');
console.log('LICENCIA_SIGN_PUB_KEY (sistema_desktop/.env al compilar la release, base64url):');
console.log(pubRaw.toString('base64url'));
