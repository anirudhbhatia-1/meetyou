import { romanRulesPolicy } from '@meetyou/hinglish';
import { describe, expect, it } from 'vitest';

import { TranscriptAssembler } from './assembler.ts';
import { StreamTimeline } from './timeline.ts';

let n = 0;
const ids = () => `seg_01J0000000000000000000${String(n++).padStart(4, '0')}`;

function timeline(): StreamTimeline {
  const t = new StreamTimeline();
  for (let ms = 0; ms < 3000; ms += 100) t.sent(10_000 + ms, 100);
  return t;
}

describe('TranscriptAssembler (S2-05, ARCHITECTURE §8.1)', () => {
  it('maps times to the session clock, keeps raw text and shows text as provided by default', () => {
    const a = new TranscriptAssembler({ workspaceId: 'ws_1', meetingId: 'mtg_1', newId: ids });
    const { segments, invalid } = a.finalSegments('them', timeline(), {
      final: true,
      text: 'कल तक भेज देना, nahin?',
      startMs: 200,
      endMs: 1500,
      language: 'hi',
    });
    expect(invalid).toBe(0);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      meetingId: 'mtg_1',
      startMs: 10_200,
      endMs: 11_500,
      // Spelling variants are unified on display text only.
      text: 'कल तक भेज देना, nahi?',
      rawText: 'कल तक भेज देना, nahin?',
      language: 'hi',
      source: 'live',
      flags: [],
    });
  });

  it('turns Devanagari into Roman with the roman_rules policy, interim included', () => {
    const a = new TranscriptAssembler({
      workspaceId: 'ws_1',
      meetingId: 'mtg_1',
      display: romanRulesPolicy(),
      newId: ids,
    });
    expect(a.interimText('कल deployment')).toBe('kal deployment');
    const { segments } = a.finalSegments('me', timeline(), {
      final: true,
      text: 'कल deployment करते हैं',
      startMs: 0,
      endMs: 900,
    });
    expect(segments[0]).toMatchObject({ text: 'kal deployment karte hain', language: 'und' });
  });

  it('gives each diarized speaker run its own segment and cluster label', () => {
    const a = new TranscriptAssembler({ workspaceId: 'ws_1', meetingId: 'mtg_1', newId: ids });
    const { segments } = a.finalSegments('them', timeline(), {
      final: true,
      text: 'haan theek hai',
      startMs: 0,
      endMs: 900,
      words: [
        { text: 'haan', startMs: 0, endMs: 300, speaker: 0 },
        { text: 'theek', startMs: 300, endMs: 600, speaker: 1 },
        { text: 'hai', startMs: 600, endMs: 900, speaker: 1 },
      ],
    });
    expect(segments.map((s) => [s.text, s.speakerClusterId])).toEqual([
      ['haan', 'spk_1'],
      ['theek hai', 'spk_2'],
    ]);
    expect(new Set(segments.map((s) => s.id)).size).toBe(2);
  });

  it('flags a me segment that repeats the other lane (echo), without dropping it', () => {
    const a = new TranscriptAssembler({ workspaceId: 'ws_1', meetingId: 'mtg_1', newId: ids });
    const result = {
      final: true,
      text: 'the release moves to Friday',
      startMs: 0,
      endMs: 1500,
    } as const;
    a.finalSegments('them', timeline(), result);
    const echo = a.finalSegments('me', timeline(), result);
    expect(echo.segments[0]?.flags).toEqual(['echo']);
    expect(echo.echoFlags[0]?.flag).toBe(true);
  });
});
