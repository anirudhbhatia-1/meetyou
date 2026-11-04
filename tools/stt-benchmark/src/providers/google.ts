import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { v2 } from '@google-cloud/speech';
import { z } from 'zod';
import type { ProviderOptions } from '../schemas.ts';
import { requireEnv, type BatchProvider, type StreamProvider } from './types.ts';

type GoogleOptions = Extract<ProviderOptions, { provider: 'google' }>;

/**
 * Google Cloud Speech-to-Text V2, Chirp 3 (docs.cloud.google.com/speech-to-text/v2/docs/chirp_3-model).
 * Auth is Application Default Credentials (`gcloud auth application-default login` or a service
 * account key in GOOGLE_APPLICATION_CREDENTIALS). Cloud STT does not use audio for training unless
 * the project opts into data logging, which stays off (STT_PREFLIGHT §5).
 */
export function googleRecognizer(o: GoogleOptions, project: string): string {
  return `projects/${project}/locations/${o.location}/recognizers/_`;
}

/** First request of a StreamingRecognize call: the config; audio follows in later requests. */
export function googleStreamingConfig(o: GoogleOptions, project: string, vocabulary: string[]) {
  return {
    recognizer: googleRecognizer(o, project),
    streamingConfig: {
      config: {
        explicitDecodingConfig: {
          encoding: o.encoding === 'ogg_opus' ? ('OGG_OPUS' as const) : ('LINEAR16' as const),
          sampleRateHertz: 16000,
          audioChannelCount: 1,
        },
        languageCodes: o.languageCodes,
        model: o.model,
        features: { enableAutomaticPunctuation: true },
        ...(o.keyterms && vocabulary.length
          ? {
              adaptation: {
                phraseSets: [
                  {
                    inlinePhraseSet: {
                      phrases: vocabulary.slice(0, 1000).map((value) => ({ value, boost: 10 })),
                    },
                  },
                ],
              },
            }
          : {}),
      },
      streamingFeatures: { interimResults: true },
    },
  };
}

const Duration = z
  .object({ seconds: z.union([z.string(), z.number()]).optional(), nanos: z.number().optional() })
  .nullish();

const StreamingResponse = z
  .object({
    results: z
      .array(
        z
          .object({
            alternatives: z.array(z.object({ transcript: z.string().nullish() }).loose()).nullish(),
            isFinal: z.boolean().nullish(),
            resultEndOffset: Duration,
          })
          .loose(),
      )
      .nullish(),
  })
  .loose();

function seconds(d: z.infer<typeof Duration>): number | undefined {
  if (!d) return undefined;
  return Number(d.seconds ?? 0) + (d.nanos ?? 0) / 1e9;
}

/** Interim and final transcripts from one streaming response (offsets are per session). */
export function googleResults(raw: unknown): { final: boolean; text: string; end?: number }[] {
  const out: { final: boolean; text: string; end?: number }[] = [];
  for (const r of StreamingResponse.parse(raw).results ?? []) {
    const text = (r.alternatives?.[0]?.transcript ?? '').trim();
    if (!text) continue;
    const end = seconds(r.resultEndOffset);
    out.push({ final: r.isFinal === true, text, ...(end !== undefined ? { end } : {}) });
  }
  return out;
}

export const googleStream: StreamProvider<GoogleOptions> = {
  // StreamingRecognize streams are limited to 5 minutes (V2 quotas); the runner rotates before that.
  maxSessionMs: 5 * 60 * 1000,
  async open(options, ctx, emit) {
    const project = requireEnv('GOOGLE_CLOUD_PROJECT');
    const client = new v2.SpeechClient({
      apiEndpoint:
        options.location === 'global'
          ? 'speech.googleapis.com'
          : `${options.location}-speech.googleapis.com`,
    });
    const stream = client._streamingRecognize();
    let utterance = 0;
    stream.on('data', (data: unknown) => {
      for (const r of googleResults(data)) {
        if (r.final) emit({ kind: 'final', text: r.text, utteranceId: String(utterance++) });
        else emit({ kind: 'interim', text: r.text, utteranceId: String(utterance) });
      }
    });
    stream.on('error', (e: Error) => emit({ kind: 'error', message: e.message }));
    // A failed stream emits 'error' and may never emit 'end'.
    const closed = new Promise<void>((resolve) => {
      const done = () => {
        emit({ kind: 'session', event: 'close' });
        resolve();
      };
      stream.once('end', done);
      stream.once('error', done);
    });
    stream.write(googleStreamingConfig(options, project, ctx.vocabulary));
    emit({ kind: 'session', event: 'open' });

    // ADR-0003 §3.1 check 5: does Chirp 3 streaming accept Ogg Opus? ffmpeg encodes the PCM chunks
    // the runner sends to 24 kbps voip Opus in 100 ms Ogg pages, like the gateway's own muxer.
    let opus: ChildProcessWithoutNullStreams | null = null;
    if (options.encoding === 'ogg_opus') {
      opus = spawn('ffmpeg', [
        ...['-loglevel', 'error', '-f', 's16le', '-ar', '16000', '-ac', '1', '-i', 'pipe:0'],
        ...['-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', '-frame_duration', '20'],
        ...['-page_duration', '100000', '-flush_packets', '1', '-f', 'ogg', 'pipe:1'],
      ]);
      opus.stdout.on('data', (data: Buffer) => {
        if (stream.writable) stream.write({ audio: data });
      });
    }
    const encoder = opus;
    const encoded =
      encoder === null
        ? Promise.resolve()
        : new Promise<void>((resolve) => encoder.stdout.once('end', () => resolve()));

    return {
      send(chunk) {
        if (encoder !== null) encoder.stdin.write(chunk);
        else if (stream.writable) stream.write({ audio: chunk });
      },
      async end() {
        encoder?.stdin.end();
        await encoded;
        stream.end();
        await closed;
        await client.close();
      },
    };
  },
};

/**
 * BatchRecognize reads audio from Cloud Storage only, so batch runs need a bucket; not built yet
 * (ADR-0001 §9). Streaming is the gate for the live product.
 */
export const googleBatch: BatchProvider<GoogleOptions> = {
  transcribe() {
    return Promise.reject(
      new Error('Google batch is not supported by the benchmark yet; use mode "stream"'),
    );
  },
  toHypothesis() {
    throw new Error('Google batch is not supported by the benchmark yet');
  },
};
