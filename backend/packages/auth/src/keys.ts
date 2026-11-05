import { exportJWK, generateKeyPair, importJWK, type CryptoKey, type JWK } from 'jose';

export const SIGNING_ALG = 'ES256';

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  /** Public JWK published in the JWKS. */
  publicJwk: JWK;
}

/**
 * Our signing keys (ADR-0004 §4.3): the first signs; all are published in the JWKS, so tokens
 * signed with the previous key verify until they expire (90-day rotation).
 */
export interface KeyRing {
  current: SigningKey;
  /** Public keys of the current and previous signing keys. */
  jwks: { keys: JWK[] };
}

/**
 * Loads keys from private JWKs, e.g. the JSON array in Secret Manager
 * (`AUTH_SIGNING_JWKS='[{"kty":"EC","crv":"P-256","kid":"2026-11",…,"d":"…"}]'`). Never logged.
 */
export async function loadKeyRing(privateJwks: readonly JWK[]): Promise<KeyRing> {
  if (privateJwks.length === 0) throw new Error('no signing keys');
  const keys: SigningKey[] = [];
  for (const jwk of privateJwks) {
    if (typeof jwk.kid !== 'string' || jwk.kid === '') throw new Error('signing key without kid');
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') {
      throw new Error('signing keys must be private P-256 EC JWKs');
    }
    const privateKey = (await importJWK(jwk, SIGNING_ALG)) as CryptoKey;
    // Only public members reach the JWKS; `d` is the private scalar.
    const publicJwk: JWK = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: jwk.kid };
    keys.push({
      kid: jwk.kid,
      privateKey,
      publicJwk: { ...publicJwk, alg: SIGNING_ALG, use: 'sig' },
    });
  }
  const [current] = keys;
  if (current === undefined) throw new Error('no signing keys');
  return { current, jwks: { keys: keys.map((k) => k.publicJwk) } };
}

/** A fresh private JWK for local development, tests and key rotation. */
export async function generateSigningJwk(kid: string): Promise<JWK> {
  const { privateKey } = await generateKeyPair(SIGNING_ALG, { extractable: true });
  return { ...(await exportJWK(privateKey)), kid, alg: SIGNING_ALG };
}
