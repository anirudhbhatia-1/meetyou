import { describe, expect, it } from 'vitest';

import {
  badgeFor,
  hasLeftCall,
  canStart,
  IDLE_CAPTURE,
  elapsedMs,
  nextCaptureState,
  parseCaptureState,
  type CaptureEvent,
  type CaptureState,
} from './capture-state.ts';

const both = { me: true, them: true };

function run(state: CaptureState, ...events: CaptureEvent[]): CaptureState {
  return events.reduce(nextCaptureState, state);
}

function started(link: CaptureState['link'] = 'online'): CaptureEvent {
  return {
    type: 'started',
    sessionId: 's1',
    lanes: both,
    micError: null,
    link,
    video: 'recording',
  };
}

function recording(link: CaptureState['link'] = 'online'): CaptureState {
  return run(
    IDLE_CAPTURE,
    { type: 'start_requested', tabId: 7, meetingCode: 'abc-defg-hij', at: 1000 },
    started(link),
  );
}

describe('nextCaptureState', () => {
  it('runs idle → starting → recording → stopping → processing when streamed', () => {
    const rec = recording();
    expect(rec).toMatchObject({
      status: 'recording',
      tabId: 7,
      meetingCode: 'abc-defg-hij',
      sessionId: 's1',
      startedAt: 1000,
    });
    const stopping = nextCaptureState(rec, { type: 'stop_requested' });
    expect(stopping.status).toBe('stopping');
    const processing = nextCaptureState(stopping, { type: 'stopped' });
    expect(processing).toMatchObject({ status: 'processing', sessionId: 's1', tabId: null });
    expect(nextCaptureState(processing, { type: 'processed' }).status).toBe('ready');
  });

  it('returns to idle after a local-only recording', () => {
    const local: CaptureEvent = {
      type: 'started',
      sessionId: 'local_01JC0000000000000000000000',
      lanes: both,
      micError: null,
      link: 'off',
      video: 'recording',
    };
    const rec = run(
      IDLE_CAPTURE,
      { type: 'start_requested', tabId: 7, meetingCode: null, at: 1 },
      local,
    );
    expect(run(rec, { type: 'stop_requested' }, { type: 'stopped' })).toEqual(IDLE_CAPTURE);
  });

  it('still processes a streamed recording whose link was refused before stop', () => {
    const rec = recording('off');
    const processing = run(rec, { type: 'stop_requested' }, { type: 'stopped' });
    expect(processing).toMatchObject({ status: 'processing', sessionId: 's1' });
  });

  it('ignores a second start while one is in progress or recording', () => {
    const starting = nextCaptureState(IDLE_CAPTURE, {
      type: 'start_requested',
      tabId: 1,
      meetingCode: 'abc-defg-hij',
      at: 0,
    });
    expect(
      nextCaptureState(starting, {
        type: 'start_requested',
        tabId: 2,
        meetingCode: 'abc-defg-hij',
        at: 0,
      }),
    ).toBe(starting);
    const rec = recording();
    expect(
      nextCaptureState(rec, {
        type: 'start_requested',
        tabId: 2,
        meetingCode: 'abc-defg-hij',
        at: 0,
      }),
    ).toBe(rec);
  });

  it('allows a new start while an earlier meeting is processing', () => {
    const processing = run(recording(), { type: 'stop_requested' }, { type: 'stopped' });
    expect(canStart(processing)).toBe(true);
    expect(
      nextCaptureState(processing, {
        type: 'start_requested',
        tabId: 3,
        meetingCode: 'abc-defg-hij',
        at: 5,
      }).status,
    ).toBe('starting');
  });

  it('pauses and resumes, keeping the link state', () => {
    const paused = nextCaptureState(recording(), { type: 'paused', at: 0 });
    expect(paused.status).toBe('paused');
    const stillPaused = nextCaptureState(paused, { type: 'link_changed', link: 'reconnecting' });
    expect(stillPaused).toMatchObject({ status: 'paused', link: 'reconnecting' });
    expect(nextCaptureState(stillPaused, { type: 'resumed', at: 0 }).status).toBe('reconnecting');
  });

  it('leaves paused time out of the elapsed time', () => {
    const paused = nextCaptureState(recording(), { type: 'paused', at: 61_000 });
    expect(elapsedMs(paused, 999_000)).toBe(60_000);
    const resumed = nextCaptureState(paused, { type: 'resumed', at: 121_000 });
    expect(resumed).toMatchObject({ pausedAt: null, pausedMs: 60_000 });
    expect(elapsedMs(resumed, 131_000)).toBe(70_000);
    expect(parseCaptureState(JSON.parse(JSON.stringify(resumed)))).toEqual(resumed);
  });

  it('keeps the recorded time when a running recording is lost', () => {
    const lost = nextCaptureState(recording(), {
      type: 'failed',
      error: 'capture_lost',
      at: 91_000,
    });
    expect(lost).toMatchObject({ status: 'error', stoppedAfterMs: 90_000, startedAt: null });
    const refused = nextCaptureState(IDLE_CAPTURE, { type: 'failed', error: 'not_meet_tab' });
    expect(refused.stoppedAfterMs).toBeNull();
  });

  it('moves between recording and reconnecting with the gateway link', () => {
    const lost = nextCaptureState(recording(), { type: 'link_changed', link: 'reconnecting' });
    expect(lost.status).toBe('reconnecting');
    expect(nextCaptureState(lost, { type: 'link_changed', link: 'online' }).status).toBe(
      'recording',
    );
  });

  it('records a tab-only start and keeps recording when the mic is lost', () => {
    const lost = nextCaptureState(recording(), { type: 'mic_lost' });
    expect(lost.status).toBe('recording');
    expect(lost.lanes).toEqual({ me: false, them: true });
  });

  it('restores the mic lane after another microphone is chosen', () => {
    const lost = nextCaptureState(recording(), { type: 'mic_lost' });
    expect(nextCaptureState(lost, { type: 'mic_restored' })).toMatchObject({
      lanes: { me: true, them: true },
      micError: null,
    });
    expect(nextCaptureState(IDLE_CAPTURE, { type: 'mic_restored' })).toBe(IDLE_CAPTURE);
  });

  it('stops from paused and reconnecting', () => {
    for (const s of [
      nextCaptureState(recording(), { type: 'paused', at: 0 }),
      nextCaptureState(recording(), { type: 'link_changed', link: 'reconnecting' }),
    ]) {
      expect(nextCaptureState(s, { type: 'stop_requested' }).status).toBe('stopping');
    }
  });

  it('moves to error from any status and allows a new start from error', () => {
    const failed = nextCaptureState(recording(), { type: 'failed', error: 'capture_lost' });
    expect(failed).toEqual({ ...IDLE_CAPTURE, status: 'error', error: 'capture_lost' });
    expect(
      nextCaptureState(failed, {
        type: 'start_requested',
        tabId: 9,
        meetingCode: 'abc-defg-hij',
        at: 0,
      }).status,
    ).toBe('starting');
    expect(nextCaptureState(failed, { type: 'dismissed' })).toEqual(IDLE_CAPTURE);
  });

  it('tracks live transcript health while capturing and resets it after stop', () => {
    const rec = recording();
    const delayed = nextCaptureState(rec, { type: 'stt_changed', stt: 'degraded' });
    expect(delayed.stt).toBe('degraded');
    expect(nextCaptureState(delayed, { type: 'stt_changed', stt: 'degraded' })).toBe(delayed);
    const processing = run(delayed, { type: 'stop_requested' }, { type: 'stopped' });
    expect(processing.stt).toBe('ok');
    expect(nextCaptureState(IDLE_CAPTURE, { type: 'stt_changed', stt: 'down' })).toBe(IDLE_CAPTURE);
    expect(parseCaptureState({ ...delayed, stt: 'bogus' }).stt).toBe('ok');
  });

  it('dismisses processing back to idle, but never a live recording', () => {
    const processing = run(recording(), { type: 'stop_requested' }, { type: 'stopped' });
    expect(processing.status).toBe('processing');
    expect(nextCaptureState(processing, { type: 'dismissed' })).toEqual(IDLE_CAPTURE);
    const rec = recording();
    expect(nextCaptureState(rec, { type: 'dismissed' })).toBe(rec);
  });

  it('does not stop from idle or finish a stop that was never requested', () => {
    expect(nextCaptureState(IDLE_CAPTURE, { type: 'stop_requested' })).toBe(IDLE_CAPTURE);
    const rec = recording();
    expect(nextCaptureState(rec, { type: 'stopped' })).toBe(rec);
  });
});

describe('parseCaptureState', () => {
  it('round-trips a stored state, so a restarted worker sees the same recording', () => {
    const rec = recording();
    expect(parseCaptureState(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
  });

  it('falls back to idle for missing or malformed values', () => {
    expect(parseCaptureState(undefined)).toEqual(IDLE_CAPTURE);
    expect(parseCaptureState({ status: 'flying' })).toEqual(IDLE_CAPTURE);
    expect(parseCaptureState({ status: 'error', error: 'made_up', link: 'warp' })).toEqual({
      ...IDLE_CAPTURE,
      status: 'error',
    });
  });
});

describe('badgeFor', () => {
  it('shows REC only while recording and clears when idle', () => {
    expect(badgeFor(recording()).text).toBe('REC');
    expect(badgeFor(nextCaptureState(recording(), { type: 'paused', at: 0 })).text).toBe('❚❚');
    expect(badgeFor(IDLE_CAPTURE).text).toBe('');
  });
});

describe('hasLeftCall', () => {
  it('stops only after the call was joined and the tab reports anything else', () => {
    const rec = recording();
    expect(hasLeftCall(rec, 'lobby')).toBe(false); // started before joining
    const joined = nextCaptureState(rec, { type: 'call_joined' });
    expect(joined.callJoined).toBe(true);
    expect(hasLeftCall(joined, 'in_call')).toBe(false);
    for (const s of ['lobby', 'ended', 'home', 'not_meet'] as const) {
      expect(hasLeftCall(joined, s)).toBe(true);
    }
  });

  it('forgets the joined call when a new recording starts', () => {
    const joined = nextCaptureState(recording(), { type: 'call_joined' });
    const failed = nextCaptureState(joined, { type: 'failed', error: 'capture_lost' });
    const again = nextCaptureState(failed, {
      type: 'start_requested',
      tabId: 1,
      meetingCode: 'abc-defg-hij',
      at: 0,
    });
    expect(again.callJoined).toBe(false);
    expect(nextCaptureState(IDLE_CAPTURE, { type: 'call_joined' })).toBe(IDLE_CAPTURE);
  });
});
