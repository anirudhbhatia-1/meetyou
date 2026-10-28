import { describe, expect, it } from 'vitest';
import {
  AUDIO_FRAME_HEADER_BYTES,
  CaptureEvent,
  ClientMessage,
  DEFAULT_USER_SETTINGS,
  PCM16_FRAME_BYTES,
  Segment,
  ServerMessage,
  StartSessionResponse,
  SummaryOutput,
  UserSettings,
  decodeAudioFrame,
  encodeAudioFrame,
  summaryOutputJsonSchema,
} from './index.ts';

const ULID = '01JBX7W3Q8M4K2T6V9R5N1P3ZA';

describe('capture events', () => {
  it('accepts every event type', () => {
    const events = [
      {
        type: 'session.started',
        sessionId: 's1',
        platform: 'google_meet',
        startedAt: '2026-10-28T10:00:00+05:30',
      },
      {
        type: 'participant.joined',
        sessionId: 's1',
        participantId: 'p1',
        displayName: 'Rahul',
        at: 0,
      },
      { type: 'participant.left', sessionId: 's1', participantId: 'p1', at: 5000 },
      { type: 'speaker.active', sessionId: 's1', participantId: 'p1', at: 1200 },
      { type: 'mic.mute_changed', sessionId: 's1', muted: true, at: 1300 },
      { type: 'caption.observed', sessionId: 's1', text: 'hello', at: 1400 },
      { type: 'consent.notice', sessionId: 's1', mode: 'one_click', outcome: 'posted', at: 10 },
      {
        type: 'session.ended',
        sessionId: 's1',
        reason: 'user_stopped',
        endedAt: '2026-10-28T10:30:00Z',
      },
    ];
    for (const e of events) expect(CaptureEvent.safeParse(e).success).toBe(true);
  });

  it('rejects untrusted names that are too long and unknown types', () => {
    expect(
      CaptureEvent.safeParse({
        type: 'participant.joined',
        sessionId: 's1',
        participantId: 'p1',
        displayName: 'x'.repeat(201),
        at: 0,
      }).success,
    ).toBe(false);
    expect(CaptureEvent.safeParse({ type: 'audio.chunk', sessionId: 's1' }).success).toBe(false);
  });
});

describe('ws protocol', () => {
  it('parses hello and server messages', () => {
    expect(
      ClientMessage.safeParse({
        type: 'hello',
        protocolVersion: 1,
        sessionId: 's1',
        resumeFrom: { me: -1, them: 41 },
        format: { codec: 'pcm16', sampleRate: 16000, channels: 1, frameMs: 100 },
      }).success,
    ).toBe(true);
    expect(ServerMessage.safeParse({ type: 'ack', lane: 'them', upToSeq: 41 }).success).toBe(true);
    expect(
      ServerMessage.safeParse({
        type: 'health',
        stt: 'degraded',
        lanes: { me: { receiving: true }, them: { receiving: false } },
      }).success,
    ).toBe(true);
  });

  it('round-trips binary audio frames', () => {
    const payload = new Uint8Array(PCM16_FRAME_BYTES).map((_, i) => i % 256);
    const bytes = encodeAudioFrame({ lane: 'them', seq: 123456, captureMs: 98_765_432, payload });
    expect(bytes.byteLength).toBe(AUDIO_FRAME_HEADER_BYTES + PCM16_FRAME_BYTES);
    const frame = decodeAudioFrame(bytes);
    expect(frame.lane).toBe('them');
    expect(frame.seq).toBe(123456);
    expect(frame.captureMs).toBe(98_765_432);
    expect(Array.from(frame.payload)).toEqual(Array.from(payload));
  });

  it('rejects malformed frames', () => {
    expect(() => decodeAudioFrame(new Uint8Array(4))).toThrow(RangeError);
    const bad = encodeAudioFrame({ lane: 'me', seq: 1, captureMs: 1, payload: new Uint8Array(2) });
    bad[0] = 7;
    expect(() => decodeAudioFrame(bad)).toThrow(/lane/);
    expect(() =>
      encodeAudioFrame({ lane: 'me', seq: -1, captureMs: 0, payload: new Uint8Array() }),
    ).toThrow(RangeError);
  });
});

describe('segments', () => {
  const base = {
    id: `seg_${ULID}`,
    workspaceId: 'w1',
    meetingId: 'm1',
    lane: 'them',
    startMs: 1000,
    endMs: 2500,
    text: 'kal deployment karte hain',
    rawText: 'कल deployment करते हैं',
    language: 'hi',
    source: 'live',
  };

  it('keeps both display and raw text and defaults flags', () => {
    const parsed = Segment.parse(base);
    expect(parsed.flags).toEqual([]);
    expect(parsed.rawText).not.toBe(parsed.text);
  });

  it('rejects bad IDs and reversed times', () => {
    expect(Segment.safeParse({ ...base, id: 'seg_123' }).success).toBe(false);
    expect(Segment.safeParse({ ...base, endMs: 10 }).success).toBe(false);
  });
});

describe('summary output', () => {
  const valid = {
    title: 'Q4 launch sync',
    overview: 'Launch fixed for 15 November.',
    anchored_sections: [
      { note_id: 'n1', details: [{ text: 'Agreed.', segment_ids: [`seg_${ULID}`] }] },
    ],
    decisions: [{ text: 'Launch on 15 Nov', segment_ids: [`seg_${ULID}`] }],
    action_items: [
      {
        task: 'Pricing page draft',
        owner_participant_id: 'unassigned',
        due_date: null,
        due_phrase: 'this week',
        segment_ids: [`seg_${ULID}`],
      },
    ],
    open_questions: [],
    topics: ['launch'],
  };

  it('accepts a cited summary and rejects uncited items', () => {
    expect(SummaryOutput.safeParse(valid).success).toBe(true);
    expect(
      SummaryOutput.safeParse({ ...valid, decisions: [{ text: 'x', segment_ids: [] }] }).success,
    ).toBe(false);
  });

  it('exports a JSON Schema for structured output', () => {
    const schema = summaryOutputJsonSchema as { type?: string; required?: string[] };
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['title', 'overview', 'decisions', 'action_items']),
    );
  });
});

describe('rest dto', () => {
  it('default settings follow decisions D-01 and D-02', () => {
    const settings = UserSettings.parse({ ...DEFAULT_USER_SETTINGS, consentAcknowledgedAt: null });
    expect(settings.hindiScript).toBe('roman');
    expect(settings.retentionPolicy).toBe('7d');
    expect(settings.consentMode).toBe('one_click');
  });

  it('requires a wss stream URL', () => {
    const res = {
      sessionId: 's1',
      meetingId: 'm1',
      streamToken: 't',
      expiresAt: '2026-10-28T10:10:00Z',
      audioFormat: { codec: 'opus', sampleRate: 16000, channels: 1, frameMs: 100 },
    };
    expect(
      StartSessionResponse.safeParse({ ...res, streamUrl: 'wss://gw.example.com/v1/stream' })
        .success,
    ).toBe(true);
    expect(
      StartSessionResponse.safeParse({ ...res, streamUrl: 'https://gw.example.com' }).success,
    ).toBe(false);
  });
});
