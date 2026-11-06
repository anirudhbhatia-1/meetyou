import WebSocket from 'ws';
import { z } from 'zod';

import type {
  SttCapabilities,
  SttInput,
  SttOpenOptions,
  SttResult,
  SttStream,
  SttStreamHandlers,
  SttStreamingProvider,
} from './types.ts';

/**
 * Nova-3 multilingual streaming list price, ~$0.0092/min (third-party source, STT_PREFLIGHT §1).
 * [Verify] on Deepgram's pricing page and whether `mip_opt_out` changes it (STT_PREFLIGHT §3.6).
 */
export const DEEPGRAM_USD_PER_MINUTE = 0.0092;

/** On close, give up after this long without any message from Deepgram. */
const CLOSE_IDLE_MS = 10_000;

/**
 * Deepgram Nova-3 streaming, the ADR-0001 backup and the dev/test STT (decided 2026-11-03).
 * Parameters match the benchmarked config in tools/stt-benchmark (developers.deepgram.com:
 * listen-streaming, multilingual code-switching). `mip_opt_out=true` is always sent
 * (STT_PREFLIGHT §3.5). KeepAlive every 3 s of silence keeps the ~10 s idle timeout away.
 */
/** Docs recommend 20–50 key terms; the hard limit is 500 tokens per request (STT_PREFLIGHT §3.3). */
export const MAX_KEYTERMS = 50;
const KEYTERM_TOKEN_BUDGET = 500;
const MAX_KEYTERM_CHARS = 100;

/**
 * Glossary terms that fit the request: trimmed, de-duplicated, no commas (not allowed), at most
 * MAX_KEYTERMS, and within the token budget. Tokens are estimated (~4 characters each, at least one
 * per word) because Deepgram's tokenizer is not published; the estimate stays on the safe side.
 */
export function keytermsWithinBudget(terms: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let tokens = 0;
  for (const raw of terms) {
    const term = raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    if (term === '' || term.length > MAX_KEYTERM_CHARS || seen.has(term.toLowerCase())) continue;
    const cost = Math.max(term.split(' ').length, Math.ceil(term.length / 4));
    if (tokens + cost > KEYTERM_TOKEN_BUDGET || out.length >= MAX_KEYTERMS) break;
    seen.add(term.toLowerCase());
    tokens += cost;
    out.push(term);
  }
  return out;
}

export function deepgramStreamUrl(
  input: SttInput,
  diarize = false,
  keyterms: readonly string[] = [],
): string {
  const p = new URLSearchParams({
    model: 'nova-3',
    language: 'multi',
    punctuate: 'true',
    smart_format: 'true',
    mip_opt_out: 'true',
    interim_results: 'true',
    endpointing: '100',
  });
  // Containerized audio (Ogg Opus): Deepgram reads the header, so encoding and sample rate are
  // omitted (developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio).
  if (input === 'pcm16') {
    p.set('encoding', 'linear16');
    p.set('sample_rate', '16000');
    p.set('channels', '1');
  }
  p.append('language_hint', 'hi');
  p.append('language_hint', 'en');
  // FR-SPK-02: streaming diarization (`diarize` is deprecated; v2 is batch only). Speaker indices
  // are per stream. [Verify] whether diarization changes the per-minute price.
  if (diarize) p.set('diarize_model', 'latest');
  // Workspace glossary (S2-04): repeated `keyterm` parameters, no weights.
  for (const term of keytermsWithinBudget(keyterms)) p.append('keyterm', term);
  return `wss://api.deepgram.com/v1/listen?${p}`;
}

const DgWord = z.object({
  word: z.string(),
  punctuated_word: z.string().optional(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
  language: z.string().optional(),
  speaker: z.number().int().nonnegative().optional(),
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
      ...(w.speaker !== undefined ? { speaker: w.speaker } : {}),
    })),
  };
}

const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Deepgram Nova-3 as documented (STT_PREFLIGHT §3): keyterms only, no weights; diarization live. */
export const DEEPGRAM_CAPABILITIES: SttCapabilities = {
  idleTimeoutMs: 10_000,
  maxStreamMs: null,
  interim: true,
  diarization: true,
  wordTimestamps: true,
  // Seen in the live transcript (2026-11-05) and the MUCS runs: Hindi comes back in Devanagari.
  hindiScript: 'devanagari',
  vocabulary: { maxTerms: null, maxTokens: 500, midStreamUpdate: true },
  inputs: ['pcm16', 'ogg_opus'],
};

export function deepgramProvider(apiKey: string): SttStreamingProvider {
  return {
    name: 'deepgram',
    capabilities: DEEPGRAM_CAPABILITIES,
    usdPerMinute: DEEPGRAM_USD_PER_MINUTE,
    async open(
      input: SttInput,
      handlers: SttStreamHandlers,
      options: SttOpenOptions = {},
    ): Promise<SttStream> {
      const url = deepgramStreamUrl(input, options.diarize === true, options.keyterms ?? []);
      const ws = new WebSocket(url, {
        headers: { Authorization: `Token ${apiKey}` },
        // A stalled handshake would otherwise leave the lane opening forever and block `end`.
        handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
      });
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      let lastSend = Date.now();
      let lastMessage = Date.now();
      let closing = false;
      const keepAlive = setInterval(() => {
        if (Date.now() - lastSend > 3000 && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 1000);
      ws.on('message', (data, isBinary) => {
        lastMessage = Date.now();
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
        send(bytes) {
          lastSend = Date.now();
          if (ws.readyState === WebSocket.OPEN) ws.send(bytes);
        },
        async close() {
          closing = true;
          lastMessage = Date.now();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'Finalize' }));
            ws.send(JSON.stringify({ type: 'CloseStream' }));
          }
          // Deepgram closes the socket after its last result. A backlog can take about as long
          // as the audio itself (S1-11, Q5), so wait while results keep coming and stop only
          // after CLOSE_IDLE_MS of silence.
          let isClosed = false;
          void closed.then(() => (isClosed = true));
          while (!isClosed && Date.now() - lastMessage < CLOSE_IDLE_MS) {
            await Promise.race([closed, new Promise((r) => setTimeout(r, 500))]);
          }
          if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
        },
      };
    },
  };
}
