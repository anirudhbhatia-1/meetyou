import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Secrets we must keep but never read back in plain form outside the service that uses them
 * (ADR-0013: Google Calendar refresh tokens). AES-256-GCM with a 12-byte random IV; the stored
 * string is `v1.<keyId>.<iv>.<tag>.<ciphertext>` in base64url, so keys can rotate: every key in the
 * ring opens what it sealed, the first one seals. Keys come from Key Vault, never from the repo.
 */
export interface SealingKey {
  id: string;
  /** 32 random bytes. */
  key: Uint8Array;
}

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

/** `id:base64key,id2:base64key2` (the first seals) from an env var such as `CALENDAR_TOKEN_KEYS`. */
export function parseSealingKeys(raw: string | undefined): SealingKey[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw.split(',').map((entry) => {
    const [id, b64] = entry.trim().split(':');
    const key = Buffer.from(b64 ?? '', 'base64');
    if (id === undefined || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || key.length !== 32) {
      throw new Error('invalid sealing key: expected id:base64 of 32 bytes');
    }
    return { id, key };
  });
}

/** `aad` binds the secret to its row (e.g. the connection ID), so it cannot be moved to another. */
export function seal(plain: string, keys: readonly SealingKey[], aad: string): string {
  const current = keys[0];
  if (current === undefined) throw new Error('no sealing key configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, current.key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, current.id, iv, tag, data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function unseal(sealed: string, keys: readonly SealingKey[], aad: string): string {
  const [version, keyId, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || iv === undefined || tag === undefined || data === undefined) {
    throw new Error('sealed value has an unknown format');
  }
  const key = keys.find((k) => k.id === keyId);
  if (key === undefined) throw new Error('sealed with a key that is not configured');
  const decipher = createDecipheriv(ALGORITHM, key.key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
