import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseSealingKeys, seal, unseal } from './sealed.ts';

const key = (id: string) => `${id}:${randomBytes(32).toString('base64')}`;

describe('sealed secrets (ADR-0013)', () => {
  it('round-trips, never stores the plain text, and opens with an older key after rotation', () => {
    const old = parseSealingKeys(key('k1'));
    const sealed = seal('1//refresh-token', old, 'cal_1');
    expect(sealed).not.toContain('refresh');
    expect(unseal(sealed, old, 'cal_1')).toBe('1//refresh-token');
    const rotated = [...parseSealingKeys(key('k2')), ...old];
    expect(unseal(sealed, rotated, 'cal_1')).toBe('1//refresh-token');
    expect(seal('x', rotated, 'cal_1').split('.')[1]).toBe('k2');
  });

  it('refuses another row, a changed value, and an unknown key', () => {
    const keys = parseSealingKeys(key('k1'));
    const sealed = seal('secret', keys, 'cal_1');
    expect(() => unseal(sealed, keys, 'cal_2')).toThrow();
    const parts = sealed.split('.');
    parts[4] = Buffer.from('other').toString('base64url');
    expect(() => unseal(parts.join('.'), keys, 'cal_1')).toThrow();
    expect(() => unseal(sealed, parseSealingKeys(key('k9')), 'cal_1')).toThrow();
  });

  it('rejects malformed key lists', () => {
    expect(parseSealingKeys(undefined)).toEqual([]);
    expect(() => parseSealingKeys('k1:short')).toThrow();
    expect(() => parseSealingKeys(`bad id:${randomBytes(32).toString('base64')}`)).toThrow();
  });
});
