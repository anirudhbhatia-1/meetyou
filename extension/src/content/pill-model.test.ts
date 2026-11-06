import { describe, expect, it } from 'vitest';

import {
  cornerPosition,
  DEFAULT_CORNER,
  nearestCorner,
  parsePillLayout,
  pillViewFor,
} from './pill-model.ts';

describe('recording pill (DESIGN §8.4, §9)', () => {
  it('shows only while a recording is live or has failed', () => {
    for (const status of ['idle', 'starting', 'stopping', 'processing', 'ready', 'bogus']) {
      expect(pillViewFor(status, 'recording')).toBeNull();
    }
    expect(pillViewFor('recording', 'recording')).toEqual({
      label: 'Taking notes',
      tone: 'live',
      showTimer: true,
      showVideo: true,
    });
    expect(pillViewFor('recording', 'off')?.showVideo).toBe(false);
    expect(pillViewFor('recording', 'failed')?.showVideo).toBe(false);
  });

  it('uses the §8.4 and §9 wording for paused, reconnecting and error', () => {
    expect(pillViewFor('paused', 'recording')).toMatchObject({
      label: 'Paused',
      tone: 'paused',
      showVideo: false,
    });
    expect(pillViewFor('reconnecting', 'recording')).toMatchObject({
      label: 'Reconnecting — audio saved',
      tone: 'warn',
    });
    expect(pillViewFor('error', 'off')).toMatchObject({
      label: 'Recording stopped',
      tone: 'error',
    });
  });

  it('snaps to the corner of the quadrant holding the pill centre', () => {
    expect(nearestCorner(100, 100, 1280, 800)).toBe('top-left');
    expect(nearestCorner(1000, 100, 1280, 800)).toBe('top-right');
    expect(nearestCorner(100, 700, 1280, 800)).toBe('bottom-left');
    expect(nearestCorner(1000, 700, 1280, 800)).toBe('bottom-right');
  });

  it('keeps bottom corners above the Meet control bar', () => {
    expect(cornerPosition('top-left')).toEqual({
      top: '16px',
      bottom: '',
      left: '16px',
      right: '',
    });
    expect(cornerPosition('bottom-right')).toEqual({
      top: '',
      bottom: '96px',
      left: '',
      right: '16px',
    });
  });

  it('reads a stored layout and falls back on anything unexpected', () => {
    expect(parsePillLayout({ corner: 'bottom-left', collapsed: true })).toEqual({
      corner: 'bottom-left',
      collapsed: true,
    });
    expect(parsePillLayout({ corner: 'middle', collapsed: 'yes' })).toEqual({
      corner: DEFAULT_CORNER,
      collapsed: false,
    });
    expect(parsePillLayout(undefined).corner).toBe(DEFAULT_CORNER);
  });
});
