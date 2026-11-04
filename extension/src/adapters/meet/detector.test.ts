import { describe, expect, it, vi } from 'vitest';

import { detectCallState, extractMeetingCode, observeCallState } from './detector.ts';

describe('extractMeetingCode', () => {
  it('extracts meeting code from standard meet URL', () => {
    expect(extractMeetingCode('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij');
  });

  it('extracts meeting code from meet/ prefix URL', () => {
    expect(extractMeetingCode('https://meet.google.com/meet/qvb-nxjd-gco')).toBe('qvb-nxjd-gco');
  });

  it('handles query parameters and hashes', () => {
    expect(extractMeetingCode('https://meet.google.com/qvb-nxjd-gco?authuser=0&hl=en#main')).toBe(
      'qvb-nxjd-gco',
    );
  });

  it('returns null for meet home page and non-meeting URLs', () => {
    expect(extractMeetingCode('https://meet.google.com/')).toBeNull();
    expect(extractMeetingCode('https://meet.google.com/home')).toBeNull();
    expect(extractMeetingCode('https://meet.google.com/landing')).toBeNull();
  });

  it('returns null for non-Google-Meet domains', () => {
    expect(extractMeetingCode('https://example.com/abc-defg-hij')).toBeNull();
  });

  it('returns null for undefined or empty string', () => {
    expect(extractMeetingCode(undefined)).toBeNull();
    expect(extractMeetingCode('')).toBeNull();
  });
});

describe('detectCallState', () => {
  function createMockContainer(
    selectorsPresent: string[] = [],
    buttonTexts: string[] = [],
  ): ParentNode {
    return {
      querySelector: (selector: string) => {
        const found = selectorsPresent.some((s) => selector.includes(s) || s.includes(selector));
        return found ? ({} as Element) : null;
      },
      querySelectorAll: () => buttonTexts.map((textContent) => ({ textContent }) as Element),
    } as unknown as ParentNode;
  }

  it('detects not_meet when URL is outside meet.google.com', () => {
    const container = createMockContainer();
    const result = detectCallState(container, 'https://google.com/search');
    expect(result.state).toBe('not_meet');
  });

  it('detects home when on meet.google.com homepage without a code', () => {
    const container = createMockContainer();
    const result = detectCallState(container, 'https://meet.google.com/home');
    expect(result.state).toBe('home');
    expect(result.meetingCode).toBeNull();
  });

  it('detects lobby when join button is present (FR-DET-01: never in lobby)', () => {
    const container = createMockContainer(['button[aria-label*="Join now" i]']);
    const result = detectCallState(container, 'https://meet.google.com/abc-defg-hij');
    expect(result.state).toBe('lobby');
    expect(result.meetingCode).toBe('abc-defg-hij');
  });

  it('detects lobby as safe default when meeting code exists but controls have not loaded', () => {
    const container = createMockContainer([]); // No controls rendered yet
    const result = detectCallState(container, 'https://meet.google.com/abc-defg-hij');
    expect(result.state).toBe('lobby');
  });

  it('detects in_call when leave call button is present', () => {
    const container = createMockContainer(['button[aria-label*="Leave call" i]']);
    const result = detectCallState(container, 'https://meet.google.com/abc-defg-hij');
    expect(result.state).toBe('in_call');
    expect(result.meetingCode).toBe('abc-defg-hij');
    expect(result.matchedSelector).toContain('Leave call');
  });

  it('detects in_call when control bar is present', () => {
    const container = createMockContainer(['div[role="region"][aria-label*="Call controls" i]']);
    const result = detectCallState(container, 'https://meet.google.com/qvb-nxjd-gco');
    expect(result.state).toBe('in_call');
    expect(result.meetingCode).toBe('qvb-nxjd-gco');
  });

  it('detects ended when rejoin button is present', () => {
    const container = createMockContainer(['button[aria-label*="Rejoin" i]']);
    const result = detectCallState(container, 'https://meet.google.com/abc-defg-hij');
    expect(result.state).toBe('ended');
    expect(result.meetingCode).toBe('abc-defg-hij');
  });

  it('detects ended when return home button is present', () => {
    const container = createMockContainer(['button[aria-label*="Return to home screen" i]']);
    const result = detectCallState(container, 'https://meet.google.com/abc-defg-hij');
    expect(result.state).toBe('ended');
  });

  it('stays in lobby when the join button and a control-bar fallback both match', () => {
    const container = createMockContainer([
      'button[aria-label*="Join now" i]',
      'div[data-is-muted]',
    ]);
    const result = detectCallState(container, 'https://meet.google.com/abc-defg-hij');
    expect(result.state).toBe('lobby');
  });

  it('detects ended from the post-call button text when the buttons have no aria-label', () => {
    const container = createMockContainer([], ['  Rejoin ', 'Return to home screen']);
    const result = detectCallState(container, 'https://meet.google.com/hpi-yboa-kbn');
    expect(result.state).toBe('ended');
    expect(result.matchedSelector).toBe('text:rejoin');
  });

  it('does not take a Join button text for the post-call screen', () => {
    const container = createMockContainer([], ['Join now']);
    expect(detectCallState(container, 'https://meet.google.com/abc-defg-hij').state).toBe('lobby');
  });

  it('stays in_call when an ended-screen fallback also matches on the call page', () => {
    const container = createMockContainer(['button[aria-label*="Leave call" i]', 'a[href="/"]']);
    const result = detectCallState(container, 'https://meet.google.com/abc-defg-hij');
    expect(result.state).toBe('in_call');
  });
});

describe('observeCallState', () => {
  it('triggers immediate initial evaluation', () => {
    const container = {
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as Node & ParentNode;

    const onChange = vi.fn();
    const cleanup = observeCallState(container, onChange, {
      getUrl: () => 'https://meet.google.com/home',
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'home' }), 'not_meet');

    cleanup();
  });
});
