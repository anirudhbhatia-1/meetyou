import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { z } from 'zod';
import type { Hypothesis, ProviderOptions } from '../schemas.ts';
import { fetchJson, requireEnv, type BatchProvider, type StreamProvider } from './types.ts';

type DeepgramOptions = Extract<ProviderOptions, { provider: 'deepgram' }>;

/**
 * Deepgram Nova-3 (developers.deepgram.com: listen-streaming, keyterm, multilingual-code-switching).
 * `mip_opt_out=true` is always sent (Model Improvement Program opt-out, STT_PREFLIGHT §3.5).
 */
export function deepgramParams(
  o: DeepgramOptions,
  vocabulary: string[],
  streaming: boolean,
): URLSearchParams {
  const p = new URLSearchParams({
    model: o.model,
    language: o.language,
    punctuate: 'true',
    smart_format: 'true',
    mip_opt_out: 'true',
  });
  if (streaming) {
    p.set('encoding', 'linear16');
    p.set('sample_rate', '16000');
    p.set('channels', '1');
    p.set('interim_results', 'true');
    if (o.language === 'multi' && !o.extraParams.endpointing) p.set('endpointing', '100');
  }
  // [Verify] the docs mark `diarize` deprecated in favour of `diarize_model`.
  if (o.diarize) p.set('diarize_model', 'latest');
  if (o.language === 'multi') for (const h of o.languageHint ?? []) p.append('language_hint', h);
  if (o.keyterms) for (const term of vocabulary) p.append('keyterm', term);
  for (const [k, v] of Object.entries(o.extraParams)) p.set(k, v);
  return p;
}

const DgWord = z.object({
  word: z.string(),
  punctuated_word: z.string().optional(),
  start: z.number(),
  end: z.number(),
  speaker: z.number().optional(),
});

const DgResults = z.object({
  type: z.literal('Results'),
  is_final: z.boolean().optional(),
  start: z.number().optional(),
  duration: z.number().optional(),
  channel: z.object({
    alternatives: z.array(z.object({ transcript: z.string(), words: z.array(DgWord).default([]) })),
  }),
});

const DgPrerecorded = z.object({
  results: z.object({
    channels: z.array(
      z.object({
        alternatives: z.array(
          z.object({ transcript: z.string(), words: z.array(DgWord).default([]) }),
        ),
      }),
    ),
  }),
});

function toWords(words: z.infer<typeof DgWord>[]) {
  return words.map((w) => ({
    text: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    ...(w.speaker !== undefined ? { speaker: String(w.speaker) } : {}),
  }));
}

export const deepgramStream: StreamProvider<DeepgramOptions> = {
  async open(options, ctx, emit) {
    const key = requireEnv('DEEPGRAM_API_KEY');
    const url = `wss://api.deepgram.com/v1/listen?${deepgramParams(options, ctx.vocabulary, true)}`;
    const ws = new WebSocket(url, { headers: { Authorization: `Token ${key}` } });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    emit({ kind: 'session', event: 'open' });
    let utterance = 0;
    let lastSend = Date.now();
    const keepAlive = setInterval(() => {
      if (Date.now() - lastSend > 3000 && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, 1000);
    ws.on('message', (data) => {
      const parsed = DgResults.safeParse(JSON.parse(data.toString()));
      if (!parsed.success) return;
      const alt = parsed.data.channel.alternatives[0];
      if (!alt || !alt.transcript) return;
      if (parsed.data.is_final) {
        const words = toWords(alt.words);
        emit({
          kind: 'final',
          text: alt.transcript,
          utteranceId: String(utterance++),
          start: parsed.data.start,
          end:
            parsed.data.start !== undefined && parsed.data.duration !== undefined
              ? parsed.data.start + parsed.data.duration
              : undefined,
          words,
        });
      } else {
        emit({ kind: 'interim', text: alt.transcript, utteranceId: String(utterance) });
      }
    });
    ws.on('error', (e) => emit({ kind: 'error', message: e.message }));
    const closed = new Promise<void>((resolve) =>
      ws.once('close', (code) => {
        clearInterval(keepAlive);
        emit({ kind: 'session', event: 'close', detail: String(code) });
        resolve();
      }),
    );
    return {
      send(chunk) {
        lastSend = Date.now();
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
      },
      async end() {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'Finalize' }));
          ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
        await closed;
      },
    };
  },
};

export const deepgramBatch: BatchProvider<DeepgramOptions> = {
  async transcribe(options, wavPath, ctx) {
    const key = requireEnv('DEEPGRAM_API_KEY');
    const url = `https://api.deepgram.com/v1/listen?${deepgramParams(options, ctx.vocabulary, false)}`;
    return fetchJson(url, {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
      body: readFileSync(wavPath),
    });
  },
  toHypothesis(raw): Hypothesis {
    const alt = DgPrerecorded.parse(raw).results.channels[0]?.alternatives[0];
    return { text: alt?.transcript ?? '', words: toWords(alt?.words ?? []), segments: [] };
  },
};
