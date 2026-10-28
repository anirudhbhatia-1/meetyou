import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SarvamAIClient, type SarvamAI } from 'sarvamai';
import WebSocket from 'ws';
import { z } from 'zod';
import type { Hypothesis, ProviderOptions } from '../schemas.ts';
import { requireConfirmed, requireEnv, type BatchProvider, type StreamProvider } from './types.ts';

type SarvamOptions = Extract<ProviderOptions, { provider: 'sarvam' }>;

/** Sarvam trains on API content by default; the account opt-out must be done first (STT_PREFLIGHT §2.4). */
function guard(): string {
  requireConfirmed(
    'SARVAM_TRAINING_OPT_OUT_CONFIRMED',
    'turned off training in the Sarvam account settings',
  );
  return requireEnv('SARVAM_API_KEY');
}

export function sarvamStreamParams(o: SarvamOptions, vocabulary: string[]): URLSearchParams {
  const p = new URLSearchParams({
    language_code: o.languageCode,
    model: o.model === 'saaras:v3' ? 'saaras:v3-realtime' : o.model,
    mode: o.mode,
    encoding: 'linear16',
    sample_rate: '16000',
    return_timestamps: 'true',
  });
  // keyterms: JSON-encoded list, saaras:v4 only (docs.sarvam.ai realtime streaming guide).
  if (o.keyterms && o.model === 'saaras:v4' && vocabulary.length > 0) {
    p.set('keyterms', JSON.stringify(vocabulary.slice(0, 50).map((t) => t.slice(0, 64))));
  }
  return p;
}

const SarvamEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('transcript.partial'), utterance_idx: z.number(), text: z.string() }),
  z.object({
    event: z.literal('transcript.final'),
    utterance_idx: z.number(),
    text: z.string(),
    start_s: z.number().optional(),
    end_s: z.number().optional(),
  }),
  z.object({ event: z.literal('session.begin') }).loose(),
  z.object({ event: z.literal('session.end') }).loose(),
  z
    .object({
      event: z.literal('error'),
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .loose(),
]);

export const sarvamStream: StreamProvider<SarvamOptions> = {
  async open(options, ctx, emit) {
    const key = guard();
    const url = `wss://api.sarvam.ai/speech-to-text-realtime/ws?${sarvamStreamParams(options, ctx.vocabulary)}`;
    const ws = new WebSocket(url, { headers: { 'API-SUBSCRIPTION-KEY': key } });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    emit({ kind: 'session', event: 'open' });
    let lastSend = Date.now();
    const ping = setInterval(() => {
      if (Date.now() - lastSend > 3000 && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ event: 'ping' }));
    }, 1000);
    let ended: () => void = () => undefined;
    const sessionEnd = new Promise<void>((r) => (ended = r));
    ws.on('message', (data) => {
      const parsed = SarvamEvent.safeParse(JSON.parse(data.toString()));
      if (!parsed.success) return;
      const e = parsed.data;
      if (e.event === 'transcript.partial') {
        emit({ kind: 'interim', text: e.text, utteranceId: String(e.utterance_idx) });
      } else if (e.event === 'transcript.final') {
        emit({
          kind: 'final',
          text: e.text,
          utteranceId: String(e.utterance_idx),
          start: e.start_s,
          end: e.end_s,
        });
      } else if (e.event === 'error') {
        emit({ kind: 'error', message: `${e.code ?? ''} ${e.message ?? ''}`.trim() });
      } else if (e.event === 'session.end') {
        emit({ kind: 'session', event: 'end', detail: JSON.stringify(e) });
        ended();
      }
    });
    ws.on('error', (e) => emit({ kind: 'error', message: e.message }));
    ws.once('close', (code) => {
      clearInterval(ping);
      emit({ kind: 'session', event: 'close', detail: String(code) });
      ended();
    });
    return {
      send(chunk) {
        lastSend = Date.now();
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ event: 'audio_input', audio: chunk.toString('base64') }));
      },
      async end() {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: 'end' }));
        await sessionEnd;
        ws.close();
      },
    };
  },
};

const SarvamBatchOutput = z.object({
  transcript: z.string(),
  timestamps: z
    .object({
      chunks: z.array(z.string()),
      start_time_seconds: z.array(z.number()),
      end_time_seconds: z.array(z.number()),
    })
    .nullish(),
  diarized_transcript: z
    .object({
      entries: z.array(
        z.object({
          transcript: z.string(),
          start_time_seconds: z.number(),
          end_time_seconds: z.number(),
          speaker_id: z.string(),
        }),
      ),
    })
    .nullish(),
});

export const sarvamBatch: BatchProvider<SarvamOptions> = {
  async transcribe(options, wavPath, ctx) {
    const client = new SarvamAIClient({ apiSubscriptionKey: guard() });
    const model = (
      options.model === 'saaras:v3-realtime' ? 'saaras:v3' : options.model
    ) as SarvamAI.SpeechToTextBatchModel;
    const job = await client.speechToTextJob.createJob({
      model,
      languageCode: options.languageCode as SarvamAI.SpeechToTextLanguage,
      mode: options.mode as SarvamAI.Mode,
      withTimestamps: true,
      withDiarization: options.diarize,
      ...(ctx.speakers ? { numSpeakers: ctx.speakers } : {}),
      ...(options.keyterms && model === 'saaras:v4'
        ? { keyterms: ctx.vocabulary.slice(0, 50) }
        : {}),
    });
    await job.uploadFiles([wavPath]);
    await job.start();
    await job.waitUntilComplete(5, 1800);
    const files = await job.getFileResults();
    if (files.failed.length > 0)
      throw new Error(`Sarvam job failed: ${JSON.stringify(files.failed)}`);
    const dir = mkdtempSync(join(tmpdir(), 'sarvam-'));
    await job.downloadOutputs(dir);
    const out = readdirSync(dir).find((f) => f.endsWith('.json'));
    if (!out) throw new Error('Sarvam job produced no JSON output');
    return JSON.parse(readFileSync(join(dir, out), 'utf8')) as unknown;
  },
  toHypothesis(raw): Hypothesis {
    const o = SarvamBatchOutput.parse(raw);
    if (o.diarized_transcript?.entries.length) {
      return {
        text: o.transcript,
        words: [],
        segments: o.diarized_transcript.entries.map((e) => ({
          text: e.transcript,
          start: e.start_time_seconds,
          end: e.end_time_seconds,
          speaker: e.speaker_id,
        })),
      };
    }
    const t = o.timestamps;
    return {
      text: o.transcript,
      words: [],
      segments: t
        ? t.chunks.map((text, i) => ({
            text,
            start: t.start_time_seconds[i],
            end: t.end_time_seconds[i],
          }))
        : [],
    };
  },
};
