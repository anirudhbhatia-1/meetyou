import { describe, expect, it } from 'vitest';

import { assertFreeKeyAllowed, createProviders, ProviderEnv } from './registry.ts';
import {
  DeepgramHttpError,
  deepgramBatchProvider,
  deepgramBatchUrl,
  parseDeepgramBatch,
} from './stt/deepgram-batch.ts';
import {
  deepgramStreamUrl,
  keytermsWithinBudget,
  MAX_KEYTERMS,
  parseDeepgramMessage,
} from './stt/deepgram-streaming.ts';

describe('parseDeepgramMessage', () => {
  it('maps a final result to milliseconds and the majority word language', () => {
    const result = parseDeepgramMessage(
      JSON.stringify({
        type: 'Results',
        is_final: true,
        start: 1.5,
        duration: 1.2,
        channel: {
          alternatives: [
            {
              transcript: 'kal meeting hai',
              words: [
                { word: 'kal', start: 1.5, end: 1.8, language: 'hi' },
                { word: 'meeting', start: 1.8, end: 2.2, language: 'en' },
                { word: 'hai', start: 2.2, end: 2.7, language: 'hi' },
              ],
            },
          ],
        },
      }),
    );
    expect(result).toMatchObject({ final: true, startMs: 1500, endMs: 2700, language: 'hi' });
    expect(parseDeepgramMessage('{"type":"Metadata"}')).toBeNull();
    expect(parseDeepgramMessage('not json')).toBeNull();
  });
});

describe('deepgramStreamUrl', () => {
  it('passes the glossary as repeated keyterm parameters within the limits (STT_PREFLIGHT §3.3)', () => {
    const url = new URL(
      deepgramStreamUrl('pcm16', false, ['Minutes', 'staging, deploy', 'minutes']),
    );
    expect(url.searchParams.getAll('keyterm')).toEqual(['Minutes', 'staging deploy']);
    const many = Array.from({ length: 80 }, (_, i) => `term${i}`);
    expect(keytermsWithinBudget(many)).toHaveLength(MAX_KEYTERMS);
    const long = Array.from({ length: 40 }, (_, i) => `${'x'.repeat(60)}${i}`);
    const kept = keytermsWithinBudget(long);
    const tokens = kept.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    expect(tokens).toBeLessThanOrEqual(500);
    expect(keytermsWithinBudget(['', '   ', 'y'.repeat(101)])).toEqual([]);
  });

  it('always opts out of model improvement and hints Hindi and English', () => {
    const url = new URL(deepgramStreamUrl('ogg_opus'));
    expect(url.searchParams.get('mip_opt_out')).toBe('true');
    expect(url.searchParams.get('model')).toBe('nova-3');
    expect(url.searchParams.getAll('language_hint')).toEqual(['hi', 'en']);
    expect(url.searchParams.has('encoding')).toBe(false);
    expect(new URL(deepgramStreamUrl('pcm16')).searchParams.get('encoding')).toBe('linear16');
  });
});

const batchResponse = {
  metadata: { request_id: 'req-1', duration: 12.5 },
  results: {
    channels: [],
    utterances: [
      {
        start: 0.5,
        end: 2.25,
        transcript: 'Haan theek hai.',
        confidence: 0.9,
        speaker: 1,
        languages: ['hi'],
        words: [
          {
            word: 'haan',
            punctuated_word: 'Haan',
            start: 0.5,
            end: 0.8,
            confidence: 0.9,
            speaker: 1,
          },
        ],
      },
      { start: 3, end: 3.1, transcript: '  ', words: [] },
    ],
  },
};

describe('deepgram batch (pre-recorded)', () => {
  it('asks for utterances, Nova-3 multilingual and the opt-out', () => {
    const url = new URL(deepgramBatchUrl(true));
    expect(url.searchParams.get('utterances')).toBe('true');
    expect(url.searchParams.get('language')).toBe('multi');
    expect(url.searchParams.get('mip_opt_out')).toBe('true');
    expect(url.searchParams.get('diarize_model')).toBe('latest');
    expect(new URL(deepgramBatchUrl(false)).searchParams.has('diarize_model')).toBe(false);
  });

  it('turns utterances into segments with words, speaker and language', () => {
    expect(parseDeepgramBatch(batchResponse)).toEqual({
      segments: [
        {
          startMs: 500,
          endMs: 2250,
          text: 'Haan theek hai.',
          language: 'hi',
          confidence: 0.9,
          speaker: 1,
          words: [{ text: 'Haan', startMs: 500, endMs: 800, confidence: 0.9, speaker: 1 }],
        },
      ],
      durationMs: 12_500,
      provider: 'deepgram',
      model: 'nova-3',
      requestId: 'req-1',
    });
  });

  it('sends bytes with their content type, or a URL as JSON, and hides error bodies', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 200;
    const provider = deepgramBatchProvider('key-1', {
      fetch: ((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(
          new Response(status === 200 ? JSON.stringify(batchResponse) : 'secret detail', {
            status,
          }),
        );
      }) as unknown as typeof fetch,
    });
    await provider.transcribe({
      kind: 'bytes',
      bytes: new Uint8Array([1, 2]),
      contentType: 'audio/ogg',
    });
    await provider.transcribe({ kind: 'url', url: 'https://storage.example/a.ogg' });
    expect(calls[0]?.init.headers).toEqual({
      Authorization: 'Token key-1',
      'Content-Type': 'audio/ogg',
    });
    expect(calls[1]?.init.body).toBe(JSON.stringify({ url: 'https://storage.example/a.ogg' }));

    status = 402;
    const failure = provider.transcribe({ kind: 'url', url: 'https://storage.example/a.ogg' });
    await expect(failure).rejects.toBeInstanceOf(DeepgramHttpError);
    await expect(failure).rejects.not.toThrow(/secret/);
  });
});

describe('provider registry (ARCHITECTURE §7.3)', () => {
  it('builds nothing for STT_PROVIDER=none and both Deepgram providers otherwise', () => {
    expect(createProviders({})).toEqual({ streaming: null, batch: null });
    const providers = createProviders({ STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'k' });
    expect(providers.streaming?.name).toBe('deepgram');
    expect(providers.batch?.name).toBe('deepgram');
    expect(() => createProviders({ STT_PROVIDER: 'deepgram' })).toThrow(/DEEPGRAM_API_KEY/);
    expect(() => createProviders({ STT_PROVIDER: 'whisper' })).toThrow();
  });

  it('refuses the free Gemini key outside local and CI (ADR-0001 §7)', () => {
    const env = (APP_ENV: string) =>
      ProviderEnv.parse({ APP_ENV, GEMINI_FREE_TIER_ACCEPTED: 'true' });
    expect(() => assertFreeKeyAllowed(env('local'))).not.toThrow();
    expect(() => assertFreeKeyAllowed(env('ci'))).not.toThrow();
    expect(() => assertFreeKeyAllowed(env('staging'))).toThrow(/refused in staging/);
    expect(() => assertFreeKeyAllowed(env('production'))).toThrow(/refused in production/);
    expect(() =>
      createProviders({ APP_ENV: 'production', GEMINI_FREE_TIER_ACCEPTED: 'true' }),
    ).toThrow();
  });

  it('allows the free key on staging only with the explicit temporary exception, never in production', () => {
    const env = (APP_ENV: string) =>
      ProviderEnv.parse({
        APP_ENV,
        GEMINI_FREE_TIER_ACCEPTED: 'true',
        GEMINI_FREE_TIER_ON_STAGING: 'true',
      });
    expect(() => assertFreeKeyAllowed(env('staging'))).not.toThrow();
    expect(() => assertFreeKeyAllowed(env('production'))).toThrow(/refused in production/);
  });
});
