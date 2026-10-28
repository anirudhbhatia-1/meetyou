import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import WebSocket from 'ws';
import { z } from 'zod';
import type { Hypothesis, ProviderOptions } from '../schemas.ts';
import {
  fetchJson,
  requireConfirmed,
  requireEnv,
  sleep,
  type BatchProvider,
  type StreamProvider,
} from './types.ts';

type GeminiOptions = Extract<ProviderOptions, { provider: 'gemini' }>;

const API = 'https://generativelanguage.googleapis.com';
const LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** Free-tier data may be used for training and human review; benchmark audio has real voices (STT_PREFLIGHT §4.3). */
function guard(): string {
  requireConfirmed(
    'GEMINI_BILLING_ENABLED',
    'confirmed the API key belongs to a billing-enabled Cloud project',
  );
  return requireEnv('GEMINI_API_KEY');
}

/** Setup message for gemini-3.5-transcribe-live (ai.google.dev live-transcribe guide). */
export function geminiLiveSetup(o: GeminiOptions, vocabulary: string[]) {
  return {
    setup: {
      model: `models/${o.model}`,
      generationConfig: { responseModalities: ['TEXT'] },
      inputAudioTranscription: {
        languageCodes: o.languageCodes,
        mode: o.mode === 'smart' ? 'SMART' : 'VERBATIM',
        ...(o.keyterms && vocabulary.length ? { customVocabulary: vocabulary.slice(0, 1000) } : {}),
      },
    },
  };
}

const LiveMessage = z
  .object({
    setupComplete: z.unknown().optional(),
    goAway: z.unknown().optional(),
    serverContent: z
      .object({
        interimInputTranscription: z.object({ text: z.string() }).optional(),
        inputTranscription: z.object({ text: z.string() }).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export const geminiStream: StreamProvider<GeminiOptions> = {
  // Live transcription sessions are limited to 10 minutes; the runner rotates before that.
  maxSessionMs: 10 * 60 * 1000,
  async open(options, ctx, emit) {
    const key = guard();
    const ws = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(key)}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    let utterance = 0;
    let setupDone: () => void = () => undefined;
    const ready = new Promise<void>((r) => (setupDone = r));
    ws.on('message', (data) => {
      const parsed = LiveMessage.safeParse(JSON.parse(data.toString()));
      if (!parsed.success) return;
      const m = parsed.data;
      if (m.setupComplete !== undefined) setupDone();
      if (m.goAway !== undefined)
        emit({ kind: 'session', event: 'goaway', detail: JSON.stringify(m.goAway) });
      const interim = m.serverContent?.interimInputTranscription?.text;
      const final = m.serverContent?.inputTranscription?.text;
      if (interim) emit({ kind: 'interim', text: interim, utteranceId: String(utterance) });
      if (final) emit({ kind: 'final', text: final, utteranceId: String(utterance++) });
    });
    ws.on('error', (e) => emit({ kind: 'error', message: e.message }));
    const closed = new Promise<void>((resolve) =>
      ws.once('close', (code, reason) => {
        emit({ kind: 'session', event: 'close', detail: `${code} ${reason.toString()}` });
        resolve();
      }),
    );
    ws.send(JSON.stringify(geminiLiveSetup(options, ctx.vocabulary)));
    await ready;
    emit({ kind: 'session', event: 'open' });
    return {
      send(chunk) {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: chunk.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
            },
          }),
        );
      },
      async end() {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
        await Promise.race([closed, sleep(5000)]);
        ws.close();
        await closed;
      },
    };
  },
};

/** Request body for the Interactions API (ai.google.dev transcribe guide). */
export function geminiInteractionBody(o: GeminiOptions, fileUri: string, vocabulary: string[]) {
  if (o.keyterms && (o.diarize || o.wordTimestamps)) {
    throw new Error(
      'Gemini: custom vocabulary cannot be combined with diarization or word timestamps',
    );
  }
  if (o.mode === 'smart' && (o.diarize || o.wordTimestamps)) {
    throw new Error('Gemini: smart mode cannot be combined with diarization or word timestamps');
  }
  const mode =
    o.mode === 'smart'
      ? 'smart'
      : {
          type: 'verbatim',
          ...(o.diarize ? { diarization_mode: 'speaker' } : {}),
          ...(o.wordTimestamps ? { timestamp_granularities: ['word'] } : {}),
        };
  return {
    model: o.model.replace(/-live$/, ''),
    input: [{ type: 'audio', uri: fileUri, mime_type: 'audio/wav' }],
    generation_config: {
      transcription_config: {
        language_codes: o.languageCodes,
        mode,
        ...(o.keyterms && vocabulary.length
          ? { custom_vocabulary: vocabulary.slice(0, 1000) }
          : {}),
      },
    },
  };
}

const UploadedFile = z.object({
  file: z.object({ name: z.string(), uri: z.string(), state: z.string().optional() }),
});
const FileState = z.object({ state: z.string().optional() }).loose();
const Interaction = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    output_text: z.string().optional(),
    steps: z
      .array(
        z
          .object({
            content: z
              .array(
                z
                  .object({
                    text: z.string().optional(),
                    annotations: z
                      .array(
                        z
                          .object({
                            type: z.string(),
                            text: z.string().optional(),
                            speaker: z.string().optional(),
                            start_offset: z.string().optional(),
                            end_offset: z.string().optional(),
                          })
                          .loose(),
                      )
                      .optional(),
                  })
                  .loose(),
              )
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

async function uploadFile(key: string, path: string): Promise<string> {
  const size = statSync(path).size;
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': 'audio/wav',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: basename(path) } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) throw new Error(`Gemini upload start failed: ${start.status}`);
  const done = UploadedFile.parse(
    await fetchJson(uploadUrl, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
      body: readFileSync(path),
    }),
  );
  for (let i = 0; i < 60; i++) {
    const s = FileState.parse(
      await fetchJson(`${API}/v1beta/${done.file.name}`, { headers: { 'x-goog-api-key': key } }),
    );
    if (s.state === 'ACTIVE' || s.state === undefined) return done.file.uri;
    if (s.state === 'FAILED') throw new Error('Gemini file processing failed');
    await sleep(2000);
  }
  throw new Error('Gemini file did not become ACTIVE in time');
}

function seconds(offset: string | undefined): number | undefined {
  return offset === undefined ? undefined : Number.parseFloat(offset.replace(/s$/, ''));
}

export const geminiBatch: BatchProvider<GeminiOptions> = {
  async transcribe(options, wavPath, ctx) {
    const key = guard();
    const uri = await uploadFile(key, wavPath);
    const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json' };
    let result = Interaction.parse(
      await fetchJson(`${API}/v1beta/interactions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(geminiInteractionBody(options, uri, ctx.vocabulary)),
      }),
    );
    // [Verify] polling: the documented example returns status "completed" directly.
    for (let i = 0; i < 300 && result.status && result.status !== 'completed' && result.id; i++) {
      if (result.status === 'failed') throw new Error('Gemini interaction failed');
      await sleep(3000);
      result = Interaction.parse(await fetchJson(`${API}/v1beta/${result.id}`, { headers }));
    }
    return result;
  },
  toHypothesis(raw): Hypothesis {
    const r = Interaction.parse(raw);
    const words: Hypothesis['words'] = [];
    const texts: string[] = [];
    for (const step of r.steps ?? []) {
      for (const c of step.content ?? []) {
        if (c.text) texts.push(c.text);
        for (const a of c.annotations ?? []) {
          if (a.type !== 'word_info' || !a.text) continue;
          const start = seconds(a.start_offset);
          const end = seconds(a.end_offset);
          words.push({
            text: a.text,
            ...(start !== undefined ? { start } : {}),
            ...(end !== undefined ? { end } : {}),
            ...(a.speaker ? { speaker: a.speaker } : {}),
          });
        }
      }
    }
    return { text: r.output_text ?? texts.join(' '), words, segments: [] };
  },
};
