import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/**
 * Credential-at-rest encryption and session signing (§41).
 *
 * Algorithm: AES-256-GCM with a key derived from AI_CORE_MASTER_KEY via SHA-256.
 * The stored format is `v1:<iv-b64>:<tag-b64>:<ciphertext-b64>` so the version
 * can be rotated later without ambiguity.
 */

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'v1';

function key(): Buffer {
  return createHash('sha256').update(env.security.masterKey).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Malformed encrypted credential');
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Stable, non-reversible fingerprint so the UI can say "key present" safely. */
export function fingerprintSecret(plaintext: string): string {
  const hash = createHmac('sha256', key()).update(plaintext).digest('hex');
  return `…${hash.slice(0, 8)}`;
}

export function hashSessionToken(token: string): string {
  return createHmac('sha256', key()).update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison for any secret we accept from a caller. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString('base64url')}`;
}
