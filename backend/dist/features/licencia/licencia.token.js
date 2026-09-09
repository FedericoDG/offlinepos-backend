import crypto from 'crypto';
import { httpError } from '../../utils/api-error';
/** 33 días en segundos: misma cadencia que la app de escritorio. */
export const VIGENCIA_TOKEN_SEGUNDOS = 33 * 86400;
let clavePrivadaCache;
function obtenerClavePrivada() {
    if (clavePrivadaCache !== undefined)
        return clavePrivadaCache;
    const pem = (process.env.LICENCIA_SIGN_PRIV_KEY ?? '').replace(/\\n/g, '\n').trim();
    if (pem) {
        try {
            clavePrivadaCache = crypto.createPrivateKey({ key: pem, format: 'pem' });
            return clavePrivadaCache;
        }
        catch {
            console.error('[Licencia] LICENCIA_SIGN_PRIV_KEY inválida (no es un PEM Ed25519).');
        }
    }
    // Fallback SOLO fuera de producción: par efímero que muere al reiniciar.
    // Los tokens firmados así no los verifica ningún binario de release
    // (tiene otra pública) y dejan de valer al reiniciar: solo sirve para desarrollar.
    if (process.env.NODE_ENV !== 'production') {
        console.warn('[Licencia] LICENCIA_SIGN_PRIV_KEY no configurada: usando clave efímera de desarrollo.');
        clavePrivadaCache = crypto.generateKeyPairSync('ed25519').privateKey;
        return clavePrivadaCache;
    }
    clavePrivadaCache = null;
    return null;
}
/** Firma el payload y devuelve el token `<payload>.<firma>`. */
export function firmarTokenLicencia(payload) {
    const clave = obtenerClavePrivada();
    if (!clave) {
        throw httpError('Licenciamiento no configurado en el servidor (falta LICENCIA_SIGN_PRIV_KEY).', 500);
    }
    const cuerpo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const firma = crypto.sign(null, Buffer.from(cuerpo, 'utf8'), clave).toString('base64url');
    return `${cuerpo}.${firma}`;
}
