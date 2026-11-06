import { STANDUP_HINGLISH } from '@meetyou/fixtures';
import { describe, expect, it } from 'vitest';

import { recordStandup } from './record-fixture.ts';

describe('fixture recorder (S2-13)', () => {
  it('records the scripted meeting through the real gateway', async () => {
    const session = await recordStandup();
    const segments = session.messages.flatMap((m) =>
      m.message.type === 'transcript.segment' ? [m.message.segment] : [],
    );
    expect(segments.map((s) => s.text)).toEqual(STANDUP_HINGLISH.map((u) => u.text));
    expect(session.messages.some((m) => m.message.type === 'transcript.interim')).toBe(true);
    expect(session.messages.filter((m) => m.message.type === 'ack').length).toBeGreaterThan(0);
  }, 30_000);
});
