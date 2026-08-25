import { decryptSecret } from '@/lib/crypto';

/**
 * Credential resolution.
 *
 * A credential reference points either at an environment variable (preferred —
 * the plaintext never enters the database) or at encrypted storage. The
 * resolved plaintext is used server-side only and is never included in any
 * response, log line or run event.
 */

export type ResolvedCredential = {
  name: string;
  value: string;
  source: 'env' | 'encrypted';
  fingerprint?: string | null;
};

export async function resolveCredential(
  reference: { name: string; source: string; envVar: string | null; ciphertext: string | null; fingerprint?: string | null } | null | undefined,
): Promise<ResolvedCredential | null> {
  if (!reference) return null;

  if (reference.source === 'env' && reference.envVar) {
    const value = process.env[reference.envVar];
    if (value && value.length > 0) {
      return { name: reference.name, value, source: 'env', fingerprint: reference.fingerprint };
    }
    return null;
  }

  if (reference.ciphertext) {
    try {
      return {
        name: reference.name,
        value: decryptSecret(reference.ciphertext),
        source: 'encrypted',
        fingerprint: reference.fingerprint,
      };
    } catch {
      return null;
    }
  }

  return null;
}
