const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * ULID (github.com/ulid/spec): 48-bit millisecond time + 80 random bits, Crockford base32. Uses
 * Web Crypto, available in Node 24 and every extension context.
 */
export function newUlid(nowMs: number = Date.now()): string {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 2 ** 48 - 1) {
    throw new RangeError(`ULID time out of range: ${nowMs}`);
  }
  let time = '';
  let t = nowMs;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let random = '';
  for (const b of bytes) random += CROCKFORD.charAt(b % 32);
  return time + random;
}
