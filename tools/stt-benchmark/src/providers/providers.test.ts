import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderOptions, StreamLogLine } from '../schemas.ts';
import { runStream } from '../stream-runner.ts';
import { buildWav, parseWav } from '../wav.ts';
import { deepgramBatch, deepgramParams } from './deepgram.ts';
import {
  assertTierAllowed,
  geminiBatch,
  geminiInteractionBody,
  geminiLiveSetup,
  retryDelaySeconds,
} from './gemini.ts';
import { sarvamBatch, sarvamStreamParams } from './sarvam.ts';
import { requireConfirmed, type StreamProvider } from './types.ts';

const dg = ProviderOptions.parse({
  provider: 'deepgram',
  diarize: true,
  keyterms: true,
  languageHint: ['hi', 'en'],
});
const sv = ProviderOptions.parse({ provider: 'sarvam', model: 'saaras:v4', keyterms: true });
const gm = ProviderOptions.parse({
  provider: 'gemini',
  model: 'gemini-3.5-transcribe',
  diarize: true,
  wordTimestamps: true,
});

describe('deepgram', () => {
  it('always opts out of the model improvement program', () => {
    if (dg.provider !== 'deepgram') throw new Error('type');
    const p = deepgramParams(
      { ...dg, extraParams: { mip_opt_out: 'true' } },
      ['Rahul', 'Razorpay'],
      true,
    );
    expect(p.get('mip_opt_out')).toBe('true');
    expect(p.getAll('keyterm')).toEqual(['Rahul', 'Razorpay']);
    expect(p.getAll('language_hint')).toEqual(['hi', 'en']);
    expect(p.get('encoding')).toBe('linear16');
    expect(p.get('endpointing')).toBe('100');
  });

  it('maps prerecorded results to a hypothesis with speakers', () => {
    const hyp = deepgramBatch.toHypothesis({
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: 'kal deployment karte hain',
                words: [
                  { word: 'kal', punctuated_word: 'Kal', start: 0.1, end: 0.3, speaker: 0 },
                  { word: 'deployment', start: 0.3, end: 0.9, speaker: 1 },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(hyp.words).toEqual([
      { text: 'Kal', start: 0.1, end: 0.3, speaker: '0' },
      { text: 'deployment', start: 0.3, end: 0.9, speaker: '1' },
    ]);
  });
});

describe('sarvam', () => {
  it('builds realtime params with keyterms only for saaras:v4', () => {
    if (sv.provider !== 'sarvam') throw new Error('type');
    const p = sarvamStreamParams(sv, ['Razorpay']);
    expect(p.get('mode')).toBe('translit');
    expect(p.get('keyterms')).toBe('["Razorpay"]');
    expect(
      sarvamStreamParams({ ...sv, model: 'saaras:v3-realtime' }, ['x']).get('keyterms'),
    ).toBeNull();
  });

  it('prefers diarized entries, else timestamp chunks', () => {
    const diarized = sarvamBatch.toHypothesis({
      transcript: 'a b',
      diarized_transcript: {
        entries: [{ transcript: 'a', start_time_seconds: 0, end_time_seconds: 1, speaker_id: '0' }],
      },
    });
    expect(diarized.segments[0]).toEqual({ text: 'a', start: 0, end: 1, speaker: '0' });
    const chunks = sarvamBatch.toHypothesis({
      transcript: 'a b',
      timestamps: { chunks: ['a', 'b'], start_time_seconds: [0, 1], end_time_seconds: [1, 2] },
    });
    expect(chunks.segments).toHaveLength(2);
    // Real batch output uses `timestamps.words` (seen 2026-10-29).
    const words = sarvamBatch.toHypothesis({
      transcript: 'a b',
      timestamps: { words: ['a', 'b'], start_time_seconds: [0, 1], end_time_seconds: [1, 2] },
      diarized_transcript: null,
    });
    expect(words.segments.map((x) => x.text)).toEqual(['a', 'b']);
  });
});

describe('gemini', () => {
  it('builds the live setup and interaction body', () => {
    if (gm.provider !== 'gemini') throw new Error('type');
    const live = geminiLiveSetup({ ...gm, model: 'gemini-3.5-transcribe-live', keyterms: true }, [
      'Razorpay',
    ]);
    expect(live.setup.inputAudioTranscription.customVocabulary).toEqual(['Razorpay']);
    const body = geminiInteractionBody(gm, 'files/abc', []);
    expect(body.generation_config.transcription_config.mode).toEqual({
      type: 'verbatim',
      diarization_mode: 'speaker',
      timestamp_granularities: ['word'],
    });
  });

  it('rejects incompatible options', () => {
    if (gm.provider !== 'gemini') throw new Error('type');
    expect(() => geminiInteractionBody({ ...gm, keyterms: true }, 'u', ['x'])).toThrow(
      /vocabulary/,
    );
    expect(() => geminiInteractionBody({ ...gm, mode: 'smart' }, 'u', [])).toThrow(/smart/);
  });

  it('stops on a free-tier key unless free tier was accepted, and reads retry delays', () => {
    const err = new Error(
      'POST /v1beta/interactions → 429: limit: 10000 input tokens per minute on Free Tier. Please retry in 30s',
    );
    expect(() => assertTierAllowed(err, false)).toThrow(/FREE tier/);
    expect(() => assertTierAllowed(err, true)).not.toThrow();
    expect(retryDelaySeconds(err)).toBe(30);
    expect(retryDelaySeconds(new Error('500 internal'))).toBeUndefined();
  });

  it('parses word_info annotations', () => {
    const hyp = geminiBatch.toHypothesis({
      id: 'interactions/abc',
      status: 'completed',
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'text',
              text: 'Hello world',
              annotations: [
                {
                  type: 'word_info',
                  text: 'Hello',
                  speaker: 'spk_1',
                  start_offset: '0.100s',
                  end_offset: '0.400s',
                },
                {
                  type: 'word_info',
                  text: 'world',
                  speaker: 'spk_1',
                  start_offset: '0.500s',
                  end_offset: '0.800s',
                },
              ],
            },
          ],
        },
      ],
    });
    expect(hyp.text).toBe('Hello world');
    expect(hyp.words[1]).toEqual({ text: 'world', start: 0.5, end: 0.8, speaker: 'spk_1' });
  });
});

describe('data-use guards', () => {
  afterEach(() => delete process.env.TEST_CONFIRM);
  it('refuses to send audio until the vendor setting is confirmed', () => {
    expect(() => requireConfirmed('TEST_CONFIRM', 'done X')).toThrow(/TEST_CONFIRM=true/);
    process.env.TEST_CONFIRM = 'true';
    expect(() => requireConfirmed('TEST_CONFIRM', 'done X')).not.toThrow();
  });
});

describe('wav', () => {
  it('round-trips PCM16 audio', () => {
    const pcm = Buffer.alloc(32000);
    const audio = parseWav(buildWav(pcm));
    expect(audio).toMatchObject({ sampleRate: 16000, channels: 1, durationMs: 1000 });
  });
});

describe('stream runner', () => {
  it('paces chunks, logs messages, and rotates before the session limit', async () => {
    let opened = 0;
    const fake: StreamProvider = {
      maxSessionMs: 25_000,
      async open(_o, _c, emit) {
        opened++;
        let n = 0;
        return {
          send() {
            if (++n % 10 === 0) emit({ kind: 'final', text: `utt ${n}` });
          },
          async end() {
            emit({ kind: 'session', event: 'end' });
          },
        };
      },
    };
    const dir = mkdtempSync(join(tmpdir(), 'stream-'));
    const log = join(dir, 'x.jsonl');
    const audio = parseWav(buildWav(Buffer.alloc(32000 * 8)));
    await runStream(
      fake,
      ProviderOptions.parse({ provider: 'deepgram' }),
      audio,
      { clipId: 'c', lane: 'them', vocabulary: [] },
      log,
      1000,
    );
    const lines = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => StreamLogLine.parse(JSON.parse(l)));
    expect(lines.filter((l) => l.kind === 'sent')).toHaveLength(80);
    expect(lines.some((l) => l.kind === 'final')).toBe(true);
    // 25 s limit − 20 s margin → one rotation during 8 s of audio.
    expect(opened).toBe(2);
    expect(lines.filter((l) => l.kind === 'session' && l.event === 'rotate')).toHaveLength(1);
  });
});
