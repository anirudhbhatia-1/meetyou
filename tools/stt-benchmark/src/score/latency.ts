import type { StreamLogLine } from '../schemas.ts';
import { align } from './align.ts';

/** Energy-based voice activity detection on 16 kHz mono PCM16 (provider-independent timing). */
export function detectSpeech(
  pcm: Buffer,
  { sampleRate = 16000, frameMs = 20, thresholdDb = -40, hangoverMs = 300, minSpeechMs = 250 } = {},
): { startMs: number; endMs: number }[] {
  const frameSamples = Math.round((sampleRate * frameMs) / 1000);
  const frames = Math.floor(pcm.length / 2 / frameSamples);
  const segments: { startMs: number; endMs: number }[] = [];
  let start = -1;
  let lastVoice = -1;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let s = 0; s < frameSamples; s++) {
      const v = pcm.readInt16LE((f * frameSamples + s) * 2) / 32768;
      sum += v * v;
    }
    const db = 10 * Math.log10(sum / frameSamples + 1e-12);
    const t = f * frameMs;
    if (db >= thresholdDb) {
      if (start < 0) start = t;
      lastVoice = t + frameMs;
    } else if (start >= 0 && t - lastVoice > hangoverMs) {
      if (lastVoice - start >= minSpeechMs) segments.push({ startMs: start, endMs: lastVoice });
      start = -1;
    }
  }
  if (start >= 0 && lastVoice - start >= minSpeechMs)
    segments.push({ startMs: start, endMs: lastVoice });
  return segments;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx] ?? null;
}

/** Wall-clock send time (ms since stream start) of a position in the audio. */
function sendTimeOf(audioMs: number, sent: { t: number; audioMs: number }[]): number | undefined {
  return sent.find((s) => s.audioMs >= audioMs)?.t;
}

export interface LatencyReport {
  interimP50: number | null;
  interimP90: number | null;
  finalP50: number | null;
  finalP90: number | null;
  utterances: number;
  /** Mean token edits made to interim text before it became final, per final token. */
  interimInstability: number | null;
  disconnects: number;
  rotations: number;
}

export function analyseStream(
  log: readonly StreamLogLine[],
  speech: { startMs: number; endMs: number }[],
): LatencyReport {
  const sent = log.filter((l): l is Extract<StreamLogLine, { kind: 'sent' }> => l.kind === 'sent');
  const msgs = log.filter((l) => l.kind === 'interim' || l.kind === 'final');
  const finals = log.filter((l) => l.kind === 'final');
  const interimLat: number[] = [];
  const finalLat: number[] = [];

  for (const seg of speech) {
    const tStart = sendTimeOf(seg.startMs, sent);
    const tEnd = sendTimeOf(seg.endMs, sent);
    if (tStart !== undefined) {
      const first = msgs.find((m) => m.t >= tStart);
      if (first) interimLat.push(first.t - tStart);
    }
    if (tEnd !== undefined) {
      const fin = finals.find((m) => m.t >= tEnd);
      if (fin) finalLat.push(fin.t - tEnd);
    }
  }

  let edits = 0;
  let finalTokens = 0;
  let pending: string[] = [];
  for (const l of log) {
    if (l.kind === 'interim') pending.push(l.text);
    if (l.kind === 'final') {
      const seq = [...pending, l.text].map((s) => s.trim().split(/\s+/).filter(Boolean));
      for (let i = 1; i < seq.length; i++) {
        edits += align(seq[i - 1] ?? [], seq[i] ?? []).filter((o) => o.type !== 'match').length;
      }
      finalTokens += seq[seq.length - 1]?.length ?? 0;
      pending = [];
    }
  }

  const sessionEvents = log.filter((l) => l.kind === 'session');
  return {
    interimP50: percentile(interimLat, 50),
    interimP90: percentile(interimLat, 90),
    finalP50: percentile(finalLat, 50),
    finalP90: percentile(finalLat, 90),
    utterances: speech.length,
    interimInstability: finalTokens === 0 ? null : edits / finalTokens,
    disconnects: sessionEvents.filter((l) => l.kind === 'session' && l.event === 'disconnect')
      .length,
    rotations: sessionEvents.filter((l) => l.kind === 'session' && l.event === 'rotate').length,
  };
}
