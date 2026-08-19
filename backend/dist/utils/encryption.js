import crypto from 'crypto';
import { env } from '../config/env';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recomendado para GCM
const AUTH_TAG_LENGTH = 16;
// Asegura una clave de 32 bytes (256 bits) usando SHA-256 sobre ENCRYPTION_KEY
function getKey() {
    return crypto.createHash('sha256').update(env.ENCRYPTION_KEY).digest();
}
/**
 * Cifra un texto usando AES-256-GCM
 * Formato resultante: "iv_hex:authTag_hex:encrypted_hex"
 */
export function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}
/**
 * Descifra una cadena cifrada en formato "iv:authTag:encrypted"
 */
export function decrypt(encryptedData) {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
        throw new Error('Formato de datos cifrados inválido');
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
