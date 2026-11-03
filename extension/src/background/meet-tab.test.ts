import { describe, expect, it } from 'vitest';

import { isMeetUrl, meetingCodeOf } from './meet-tab.ts';

describe('isMeetUrl', () => {
  it('allows only HTTPS Google Meet URLs', () => {
    expect(isMeetUrl('https://meet.google.com/abc-defg-hij')).toBe(true);
    expect(isMeetUrl('https://www.google.com/meet')).toBe(false);
    expect(isMeetUrl('http://meet.google.com/abc-defg-hij')).toBe(false);
    expect(isMeetUrl(undefined)).toBe(false);
  });
});

describe('meetingCodeOf', () => {
  it('reads the meeting code from a call URL and nothing else', () => {
    expect(meetingCodeOf('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij');
    expect(meetingCodeOf('https://meet.google.com/ABC-DEFG-HIJ?authuser=1')).toBe('abc-defg-hij');
    expect(meetingCodeOf('https://meet.google.com/')).toBeNull();
    expect(meetingCodeOf('https://meet.google.com/landing')).toBeNull();
    expect(meetingCodeOf('https://example.com/abc-defg-hij')).toBeNull();
  });
});
