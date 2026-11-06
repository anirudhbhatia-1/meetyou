import { describe, expect, it } from 'vitest';

import { messagesUntil, replaySession, STANDUP_HINGLISH, standupSession } from './index.ts';

describe('recorded standup session (S2-13)', () => {
  it('is synthetic, valid against the protocol, and follows the script', () => {
    const session = standupSession();
    expect(session.synthetic).toBe(true);
    const segments = session.messages.flatMap((m) =>
      m.message.type === 'transcript.segment' ? [m.message.segment] : [],
    );
    expect(segments.map((s) => s.text)).toEqual(STANDUP_HINGLISH.map((u) => u.text));
    expect(segments.map((s) => s.lane)).toEqual(STANDUP_HINGLISH.map((u) => u.lane));
    // Two remote speakers, kept apart by diarization.
    expect(
      new Set(segments.filter((s) => s.lane === 'them').map((s) => s.speakerClusterId)),
    ).toEqual(new Set(['spk_1', 'spk_2']));
    // Recorded in time order, interim text before its final.
    const times = session.messages.map((m) => m.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(session.messages[0]?.message.type).toBe('ready');
  });

  it('cuts a session at a point in time for mid-meeting states', () => {
    const early = messagesUntil(standupSession(), 9_000);
    expect(early.filter((m) => m.type === 'transcript.segment')).toHaveLength(2);
  });

  it('replays in order at the requested speed and can stop', () => {
    const session = standupSession();
    const pending: { at: number; cb: () => void }[] = [];
    let clock = 0;
    const timers = {
      setTimeout: (cb: () => void, ms: number) => {
        pending.push({ at: clock + ms, cb });
        return pending.length;
      },
      clearTimeout: () => undefined,
    };
    const seen: number[] = [];
    let done = false;
    replaySession(session, (_m, atMs) => seen.push(atMs), {
      speed: 10,
      timers,
      onDone: () => {
        done = true;
      },
    });
    while (pending.length > 0) {
      pending.sort((a, b) => a.at - b.at);
      const next = pending.shift();
      if (next === undefined) break;
      clock = next.at;
      next.cb();
    }
    expect(seen).toEqual(session.messages.map((m) => m.atMs));
    expect(done).toBe(true);
    // 10× speed: the last message plays at a tenth of its session time.
    expect(clock).toBeCloseTo((session.messages.at(-1)?.atMs ?? 0) / 10, 0);

    const stopEarly: number[] = [];
    const stop = replaySession(session, (_m, atMs) => stopEarly.push(atMs), { timers });
    stop();
    expect(stopEarly).toEqual([]);
  });
});
