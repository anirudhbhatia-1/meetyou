import { describe, expect, it } from 'vitest';

import { isMeetUrl } from './meet-tab.ts';

describe('isMeetUrl', () => {
  it('allows only HTTPS Google Meet URLs', () => {
    expect(isMeetUrl('https://meet.google.com/abc-defg-hij')).toBe(true);
    expect(isMeetUrl('https://www.google.com/meet')).toBe(false);
    expect(isMeetUrl('http://meet.google.com/abc-defg-hij')).toBe(false);
    expect(isMeetUrl(undefined)).toBe(false);
  });
});
