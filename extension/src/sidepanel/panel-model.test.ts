import { describe, expect, it } from 'vitest';

import {
  IDLE_CAPTURE,
  type CaptureState,
  type CaptureStatus,
} from '../background/capture-state.ts';
import {
  connectionFor,
  formatClock,
  headerFor,
  micProblem,
  nextSilentSince,
  uploadPercent,
  videoLineFor,
  viewFor,
} from './panel-model.ts';

function state(status: CaptureStatus, extra: Partial<CaptureState> = {}): CaptureState {
  return { ...IDLE_CAPTURE, status, ...extra };
}

describe('side panel model (DESIGN §8.5–§8.7, §9)', () => {
  it('maps every status to a view and a labelled header', () => {
    expect(viewFor(state('idle'))).toBe('ready');
    expect(viewFor(state('starting'))).toBe('live');
    expect(viewFor(state('stopping'))).toBe('live');
    expect(viewFor(state('processing'))).toBe('processing');
    expect(viewFor(state('ready'))).toBe('ready_notes');
    expect(viewFor(state('error'))).toBe('error');

    expect(headerFor(state('idle'))).toEqual({ label: 'Not recording', tone: 'idle' });
    expect(headerFor(state('recording', { lanes: { me: true, them: true } }))).toEqual({
      label: 'Recording',
      tone: 'live',
    });
    expect(headerFor(state('reconnecting')).tone).toBe('warn');
    expect(
      headerFor(state('recording', { lanes: { me: true, them: true }, stt: 'degraded' })),
    ).toEqual({ label: 'Recording — transcript delayed', tone: 'warn' });
    expect(headerFor(state('stopping')).label).toBe('Finishing up');
    expect(headerFor(state('processing')).label).toBe('Done');
    expect(headerFor(state('error'))).toEqual({ label: 'Recording stopped', tone: 'error' });
  });

  it('tells a mic lost mid-call from a mic missing at start', () => {
    const lost = state('recording', { lanes: { me: false, them: true }, micError: 'TrackEnded' });
    expect(micProblem(lost)).toBe('lost');
    expect(headerFor(lost)).toEqual({ label: 'Your mic stopped', tone: 'warn' });
    const denied = state('recording', {
      lanes: { me: false, them: true },
      micError: 'NotAllowedError',
    });
    expect(micProblem(denied)).toBe('denied');
    expect(headerFor(denied).tone).toBe('live');
    expect(micProblem(state('recording', { lanes: { me: true, them: true } }))).toBeNull();
    expect(micProblem(state('idle'))).toBeNull();
  });

  it('describes the connection and the video lane in words', () => {
    expect(connectionFor('online')).toEqual({ text: 'Good connection', tone: 'ok' });
    expect(connectionFor('reconnecting')).toEqual({ text: 'Offline', tone: 'error' });
    expect(videoLineFor('recording')).toEqual({ recording: true, text: 'Recording screen' });
    expect(videoLineFor('failed').recording).toBe(false);
  });

  it('computes upload percent only while fragments wait', () => {
    expect(uploadPercent(0, 10)).toBeNull();
    expect(uploadPercent(3, 1)).toBe(25);
    expect(uploadPercent(1, 0)).toBe(0);
  });

  it('formats the timer as m:ss, then h:mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_400)).toBe('1:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('counts the Meet tab as silent only while the mic has signal', () => {
    // Both silent (nobody talking): not a muted call.
    expect(nextSilentSince(null, -70, -70, 1000)).toBeNull();
    // Mic talking, tab silent: starts the clock and keeps the first time.
    expect(nextSilentSince(null, -20, -70, 1000)).toBe(1000);
    expect(nextSilentSince(1000, -70, -70, 5000)).toBe(1000);
    // Any tab sound resets it.
    expect(nextSilentSince(1000, -20, -30, 6000)).toBeNull();
    // No mic lane at all: never "silent while the mic has signal".
    expect(nextSilentSince(null, null, -70, 1000)).toBeNull();
  });
});
