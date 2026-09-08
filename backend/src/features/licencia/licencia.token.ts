import crypto from 'crypto';
import { httpError } from '../../utils/api-error';

/**
 * Token de licencia firmado (Ed25519): prueba criptográfica de que EL SERVIDOR
 * validó esta instalación en un momento dado.
 *
 * Formato: `<payload base64url>.<firma base64url de los bytes del payload>`.
 * El escritorio verifica la firma con la clave pública compilada en el binario
 * y decide el acceso SOLO con el contenido del token, ignorando lo que diga
 * su SQLite local (que el usuario puede editar).
 */
export interface LicenciaTokenPayload {
  licencia_id: string;
  instalacion_id: string;
  rol: string;
  comercio_id: string;
  comercio_nombre: string;
  /** Unix (segundos) del momento de la validación en el servidor. */
  validado_en: number;
  /** Unix (segundos): validado_en + 33 días (30 de revisión + 3 de tolerancia). */
  vence_en: number;
}

/** 33 días en segundos: misma cadencia que la app de escritorio. */
export const VIGENCIA_TOKEN_SEGUNDOS = 33 * 86400;

let clavePrivadaCache: crypto.KeyObject | null | undefined;

function obtenerClavePrivada(): crypto.KeyObject | null {
  if (clavePrivadaCache !== undefined) return clavePrivadaCache;

  const pem = (process.env.LICENCIA_SIGN_PRIV_KEY ?? '').replace(/\\n/g, '\n').trim();
  if (pem) {
    try {
      clavePrivadaCache = crypto.createPrivateKey({ key: pem, format: 'pem' });
      return clavePrivadaCache;
    } catch {
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
export function firmarTokenLicencia(payload: LicenciaTokenPayload): string {
  const clave = obtenerClavePrivada();
  if (!clave) {
    throw httpError('Licenciamiento no configurado en el servidor (falta LICENCIA_SIGN_PRIV_KEY).', 500);
  }
  const cuerpo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const firma = crypto.sign(null, Buffer.from(cuerpo, 'utf8'), clave).toString('base64url');
  return `${cuerpo}.${firma}`;
}
