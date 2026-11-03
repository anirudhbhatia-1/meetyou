import { describe, expect, it } from 'vitest';

import { ULID_PATTERN } from './common.ts';
import { newUlid } from './ulid.ts';

describe('newUlid', () => {
  it('produces 26 Crockford characters that sort by time', () => {
    const a = newUlid(1_700_000_000_000);
    const b = newUlid(1_700_000_000_001);
    expect(a).toMatch(ULID_PATTERN);
    expect(a < b).toBe(true);
    expect(newUlid(0).slice(0, 10)).toBe('0000000000');
  });

  it('is unique for the same millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newUlid(5)));
    expect(ids.size).toBe(1000);
  });

  it('rejects times outside 48 bits', () => {
    expect(() => newUlid(-1)).toThrow(RangeError);
    expect(() => newUlid(2 ** 48)).toThrow(RangeError);
  });
});
