import { z } from 'zod';

/** Clip manifest (STT_BENCHMARK_PLAN §3.5). Paths are relative to the data directory. */
export const ClipManifest = z.object({
  clips: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      lanes: z.object({ me: z.string().optional(), them: z.string().optional() }),
      set: z.enum(['core', 'long', 'subset']).default('core'),
      languageMix: z.string().optional(),
      participants: z.number().int().positive().optional(),
      localSetup: z.string().optional(),
      environment: z.string().optional(),
      scenario: z.string().optional(),
      vocabulary: z.array(z.string()).default([]),
      consentRefs: z.array(z.string()).default([]),
    }),
  ),
});
export type ClipManifest = z.infer<typeof ClipManifest>;
export type Clip = ClipManifest['clips'][number];

const DeepgramOptions = z.object({
  provider: z.literal('deepgram'),
  model: z.string().default('nova-3'),
  language: z.string().default('multi'),
  languageHint: z.array(z.string()).optional(),
  diarize: z.boolean().default(false),
  keyterms: z.boolean().default(false),
  /** Extra query parameters, e.g. { endpointing: "100" }. */
  extraParams: z.record(z.string(), z.string()).default({}),
});

const SarvamOptions = z.object({
  provider: z.literal('sarvam'),
  model: z.enum(['saaras:v3-realtime', 'saaras:v4', 'saaras:v3']).default('saaras:v3-realtime'),
  languageCode: z.string().default('hi-IN'),
  mode: z.enum(['transcribe', 'translate', 'verbatim', 'translit', 'codemix']).default('translit'),
  diarize: z.boolean().default(false),
  keyterms: z.boolean().default(false),
});

const GeminiOptions = z.object({
  provider: z.literal('gemini'),
  model: z.string().default('gemini-3.5-transcribe-live'),
  languageCodes: z.array(z.string()).default([]),
  mode: z.enum(['verbatim', 'smart']).default('verbatim'),
  diarize: z.boolean().default(false),
  wordTimestamps: z.boolean().default(false),
  keyterms: z.boolean().default(false),
});

export const ProviderOptions = z.discriminatedUnion('provider', [
  DeepgramOptions,
  SarvamOptions,
  GeminiOptions,
]);
export type ProviderOptions = z.infer<typeof ProviderOptions>;

/** One run configuration = one provider setup in one mode. */
export const RunConfig = z.object({
  runs: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      mode: z.enum(['batch', 'stream']),
      lanes: z.array(z.enum(['me', 'them'])).default(['me', 'them']),
      options: ProviderOptions,
    }),
  ),
});
export type RunConfig = z.infer<typeof RunConfig>;
export type Run = RunConfig['runs'][number];

/** Reference transcript for one clip lane (ANNOTATION_GUIDELINE.md). Times in seconds. */
export const Reference = z.object({
  clipId: z.string(),
  lane: z.enum(['me', 'them']),
  words: z.array(
    z.object({
      text: z.string().min(1),
      lang: z.enum(['hi', 'en', 'other']),
      start: z.number().nonnegative().optional(),
      end: z.number().nonnegative().optional(),
      filler: z.boolean().optional(),
      unclear: z.boolean().optional(),
    }),
  ),
  entities: z
    .array(
      z.object({
        type: z.enum(['person', 'org', 'number', 'money', 'date', 'term']),
        startWord: z.number().int().nonnegative(),
        endWord: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  turns: z
    .array(
      z.object({
        speaker: z.string(),
        start: z.number().nonnegative(),
        end: z.number().nonnegative(),
      }),
    )
    .default([]),
  nonSpeech: z
    .array(z.object({ start: z.number().nonnegative(), end: z.number().nonnegative() }))
    .default([]),
});
export type Reference = z.infer<typeof Reference>;

/** Provider output normalized to one shape (times in seconds). */
export interface Hypothesis {
  text: string;
  words: { text: string; start?: number; end?: number; speaker?: string }[];
  /** Utterance/segment-level times when words are not available. */
  segments: { text: string; start?: number; end?: number; speaker?: string }[];
}

/** One line of a streaming log (JSON Lines). `t` = ms since the stream started sending. */
export const StreamLogLine = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sent'), t: z.number(), audioMs: z.number() }),
  z.object({
    kind: z.literal('interim'),
    t: z.number(),
    text: z.string(),
    utteranceId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('final'),
    t: z.number(),
    text: z.string(),
    utteranceId: z.string().optional(),
    start: z.number().optional(),
    end: z.number().optional(),
    words: z
      .array(
        z.object({
          text: z.string(),
          start: z.number().optional(),
          end: z.number().optional(),
          speaker: z.string().optional(),
        }),
      )
      .optional(),
  }),
  z.object({
    kind: z.literal('session'),
    t: z.number(),
    event: z.string(),
    detail: z.string().optional(),
  }),
  z.object({ kind: z.literal('error'), t: z.number(), message: z.string() }),
]);
export type StreamLogLine = z.infer<typeof StreamLogLine>;
