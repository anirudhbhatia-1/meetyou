import { z } from 'zod';

import { DEEPGRAM_USD_PER_MINUTE } from './deepgram-streaming.ts';
import type { BatchAudio, BatchResult, BatchSegment, SttBatchProvider } from './types.ts';

const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Deepgram Nova-3 pre-recorded (`POST /v1/listen`) for the post-meeting pass (ADR-0001 §0).
 * Parameters and response fields verified against developers.deepgram.com
 * (reference/speech-to-text/listen-pre-recorded, 2026-11-06): `language=multi` with Nova-3,
 * `diarize_model` (the `diarize` flag is deprecated), `utterances`, `mip_opt_out`, and per-utterance
 * `words[].punctuated_word`, `speaker`, `languages`. Raw audio goes in the body with its
 * Content-Type, as the S0 benchmark did for WAV. Ogg Opus as the batch pass joins it (S3-04) checked
 * 2026-11-09 on the synthetic fixture: accepted, duration matches, diarized words returned.
 */
export function deepgramBatchUrl(diarize: boolean): string {
  const p = new URLSearchParams({
    model: 'nova-3',
    language: 'multi',
    punctuate: 'true',
    smart_format: 'true',
    utterances: 'true',
    mip_opt_out: 'true',
  });
  p.append('language_hint', 'hi');
  p.append('language_hint', 'en');
  if (diarize) p.set('diarize_model', 'latest');
  return `https://api.deepgram.com/v1/listen?${p}`;
}

const DgWord = z.object({
  word: z.string(),
  punctuated_word: z.string().optional(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
  speaker: z.number().int().nonnegative().optional(),
});

const DgResponse = z.object({
  metadata: z
    .object({
      request_id: z.string().optional(),
      duration: z.number().optional(),
    })
    .default({}),
  results: z.object({
    utterances: z
      .array(
        z.object({
          start: z.number(),
          end: z.number(),
          transcript: z.string(),
          confidence: z.number().optional(),
          speaker: z.number().int().nonnegative().optional(),
          languages: z.array(z.string()).optional(),
          words: z.array(DgWord).default([]),
        }),
      )
      .default([]),
  }),
});

const ms = (seconds: number) => Math.round(seconds * 1000);

export function parseDeepgramBatch(json: unknown): BatchResult {
  const data = DgResponse.parse(json);
  const segments: BatchSegment[] = data.results.utterances
    .filter((u) => u.transcript.trim() !== '')
    .map((u) => ({
      startMs: ms(u.start),
      endMs: ms(u.end),
      text: u.transcript,
      ...(u.languages?.[0] !== undefined ? { language: u.languages[0] } : {}),
      ...(u.confidence !== undefined ? { confidence: u.confidence } : {}),
      ...(u.speaker !== undefined ? { speaker: u.speaker } : {}),
      words: u.words.map((w) => ({
        text: w.punctuated_word ?? w.word,
        startMs: ms(w.start),
        endMs: ms(w.end),
        ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
        ...(w.speaker !== undefined ? { speaker: w.speaker } : {}),
      })),
    }));
  return {
    segments,
    durationMs: ms(data.metadata.duration ?? 0),
    provider: 'deepgram',
    model: 'nova-3',
    requestId: data.metadata.request_id ?? null,
  };
}

/** HTTP status from Deepgram, without the response body (it can echo request details). */
export class DeepgramHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`deepgram http ${status}`);
    this.status = status;
  }
}

export function deepgramBatchProvider(
  apiKey: string,
  deps: { fetch?: typeof fetch } = {},
): SttBatchProvider {
  const doFetch = deps.fetch ?? fetch;
  return {
    name: 'deepgram',
    // [Verify] pre-recorded price; the streaming list price is used until confirmed.
    usdPerMinute: DEEPGRAM_USD_PER_MINUTE,
    async transcribe(audio: BatchAudio, options = {}): Promise<BatchResult> {
      const init: RequestInit =
        audio.kind === 'url'
          ? {
              headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: audio.url }),
            }
          : {
              headers: { Authorization: `Token ${apiKey}`, 'Content-Type': audio.contentType },
              body: audio.bytes,
            };
      const response = await doFetch(deepgramBatchUrl(options.diarize === true), {
        method: 'POST',
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new DeepgramHttpError(response.status);
      return parseDeepgramBatch(await response.json());
    },
  };
}
