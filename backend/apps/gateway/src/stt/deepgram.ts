import WebSocket from 'ws';
import { z } from 'zod';

import type { SttProvider, SttResult, SttStream, SttStreamHandlers } from './types.ts';

/**
 * Deepgram Nova-3 streaming, the ADR-0001 backup and the dev/test STT (decided 2026-11-03).
 * Parameters match the benchmarked config in tools/stt-benchmark (developers.deepgram.com:
 * listen-streaming, multilingual code-switching). `mip_opt_out=true` is always sent
 * (STT_PREFLIGHT §3.5). KeepAlive every 3 s of silence keeps the ~10 s idle timeout away.
 */
export function deepgramStreamUrl(): string {
  const p = new URLSearchParams({
    model: 'nova-3',
    language: 'multi',
    punctuate: 'true',
    smart_format: 'true',
    mip_opt_out: 'true',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'true',
    endpointing: '100',
  });
  p.append('language_hint', 'hi');
  p.append('language_hint', 'en');
  return `wss://api.deepgram.com/v1/listen?${p}`;
}

const DgWord = z.object({
  word: z.string(),
  punctuated_word: z.string().optional(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
  language: z.string().optional(),
});

const DgResults = z.object({
  type: z.literal('Results'),
  is_final: z.boolean().optional(),
  start: z.number(),
  duration: z.number(),
  channel: z.object({
    alternatives: z.array(
      z.object({
        transcript: z.string(),
        words: z.array(DgWord).default([]),
        languages: z.array(z.string()).optional(),
      }),
    ),
  }),
});

/** Most frequent word language, else the first alternative-level language. */
function languageOf(alt: z.infer<typeof DgResults>['channel']['alternatives'][number]) {
  const counts = new Map<string, number>();
  for (const w of alt.words)
    if (w.language) counts.set(w.language, (counts.get(w.language) ?? 0) + 1);
  let best: string | undefined;
  for (const [lang, n] of counts)
    if (best === undefined || n > (counts.get(best) ?? 0)) best = lang;
  return best ?? alt.languages?.[0];
}

export function parseDeepgramMessage(raw: string): SttResult | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = DgResults.safeParse(json);
  if (!parsed.success) return null;
  const alt = parsed.data.channel.alternatives[0];
  if (alt === undefined || alt.transcript.trim() === '') return null;
  const language = languageOf(alt);
  return {
    final: parsed.data.is_final === true,
    text: alt.transcript,
    startMs: Math.round(parsed.data.start * 1000),
    endMs: Math.round((parsed.data.start + parsed.data.duration) * 1000),
    ...(language !== undefined ? { language } : {}),
    words: alt.words.map((w) => ({
      text: w.punctuated_word ?? w.word,
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
      ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
    })),
  };
}

export function deepgramProvider(apiKey: string): SttProvider {
  return {
    name: 'deepgram',
    async open(handlers: SttStreamHandlers): Promise<SttStream> {
      const ws = new WebSocket(deepgramStreamUrl(), {
        headers: { Authorization: `Token ${apiKey}` },
      });
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      let lastSend = Date.now();
      let closing = false;
      const keepAlive = setInterval(() => {
        if (Date.now() - lastSend > 3000 && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 1000);
      ws.on('message', (data, isBinary) => {
        if (isBinary) return;
        const result = parseDeepgramMessage(data.toString());
        if (result !== null) handlers.onResult(result);
      });
      ws.on('error', () => undefined);
      const closed = new Promise<void>((resolve) => {
        ws.once('close', (code) => {
          clearInterval(keepAlive);
          if (!closing) handlers.onClosed(`close_${code}`);
          resolve();
        });
      });
      return {
        send(pcm) {
          lastSend = Date.now();
          if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
        },
        async close() {
          closing = true;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'Finalize' }));
            ws.send(JSON.stringify({ type: 'CloseStream' }));
          }
          await Promise.race([closed, new Promise((r) => setTimeout(r, 5000))]);
          if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
        },
      };
    },
  };
}
