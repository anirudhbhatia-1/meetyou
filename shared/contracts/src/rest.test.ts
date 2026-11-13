import { describe, expect, it } from 'vitest';

import { SignVideoFragmentsResponse } from './rest.ts';

const fragment = {
  index: 0,
  url: 'https://acct.blob.core.windows.net/recordings/ws/x/0.frag?sig=abc',
  expiresAt: '2026-11-13T08:00:00.000Z',
};

describe('SignVideoFragmentsResponse (ADR-0011 §3.3, ADR-0012)', () => {
  it("accepts each storage vendor's signed PUT headers", () => {
    // Azure Blob: the extension rejected this response, so no video uploaded (2026-11-13).
    expect(
      SignVideoFragmentsResponse.safeParse({
        fragments: [fragment],
        headers: { 'x-ms-blob-type': 'BlockBlob' },
      }).success,
    ).toBe(true);
    expect(
      SignVideoFragmentsResponse.safeParse({
        fragments: [fragment],
        headers: { 'x-goog-content-length-range': '0,8388608' },
      }).success,
    ).toBe(true);
  });

  it('refuses any other header, so a response cannot steer the PUT', () => {
    for (const name of ['authorization', 'cookie', 'x-msx-thing', 'content-type']) {
      expect(
        SignVideoFragmentsResponse.safeParse({ fragments: [fragment], headers: { [name]: 'v' } })
          .success,
      ).toBe(false);
    }
  });
});
