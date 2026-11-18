import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';

/**
 * Test-only stand-in for Google's ID tokens: our own RS256 key, published the way Google's JWKS
 * is, so `GoogleDeps.keys` verifies tokens signed by `sign`.
 */
export async function fakeGoogleIdTokens(clientId: string): Promise<{
  keys: JWTVerifyGetKey;
  sign: (claims: { sub: string; email: string; name?: string }) => Promise<string>;
}> {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'g1', alg: 'RS256' }],
  });
  return {
    keys,
    sign: (claims) =>
      new SignJWT({ email: claims.email, email_verified: true, name: claims.name ?? claims.email })
        .setProtectedHeader({ alg: 'RS256', kid: 'g1' })
        .setIssuer('https://accounts.google.com')
        .setAudience(clientId)
        .setSubject(claims.sub)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(pair.privateKey),
  };
}
