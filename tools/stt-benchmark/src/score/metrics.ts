import type { Normalizer } from '../normalize/index.ts';
import type { Hypothesis, Reference } from '../schemas.ts';
import { align, cer, countErrors, errorRate, type ErrorCounts, type Op } from './align.ts';

type Lang = 'hi' | 'en' | 'other';

export interface PreparedReference {
  tokens: string[];
  langs: Lang[];
  times: ({ start: number; end: number } | undefined)[];
  /** For each original word: [first token, end token) — empty for fillers/unclear words. */
  wordTokens: [number, number][];
}

export function prepareReference(ref: Reference, norm: Normalizer): PreparedReference {
  const out: PreparedReference = { tokens: [], langs: [], times: [], wordTokens: [] };
  for (const w of ref.words) {
    const start = out.tokens.length;
    if (!w.filler && !w.unclear) {
      for (const t of norm.tokens(w.text)) {
        out.tokens.push(t);
        out.langs.push(w.lang);
        out.times.push(
          w.start !== undefined && w.end !== undefined ? { start: w.start, end: w.end } : undefined,
        );
      }
    }
    out.wordTokens.push([start, out.tokens.length]);
  }
  return out;
}

export interface PreparedHypothesis {
  tokens: string[];
  times: ({ start: number; end: number } | undefined)[];
}

export function prepareHypothesis(hyp: Hypothesis, norm: Normalizer): PreparedHypothesis {
  const out: PreparedHypothesis = { tokens: [], times: [] };
  const source = hyp.words.length > 0 ? hyp.words : hyp.segments;
  if (source.length === 0) {
    for (const t of norm.tokens(hyp.text)) {
      out.tokens.push(t);
      out.times.push(undefined);
    }
    return out;
  }
  for (const w of source) {
    for (const t of norm.tokens(w.text)) {
      out.tokens.push(t);
      out.times.push(
        w.start !== undefined && w.end !== undefined ? { start: w.start, end: w.end } : undefined,
      );
    }
  }
  return out;
}

/** Errors attributed to reference token positions (insertions go to the preceding token). */
function errorsByRefIndex(ops: readonly Op[], n: number): Uint32Array {
  const e = new Uint32Array(Math.max(n, 1));
  for (const op of ops) {
    if (op.type === 'sub' || op.type === 'del') e[op.ref] = (e[op.ref] ?? 0) + 1;
    else if (op.type === 'ins') {
      const i = Math.max(0, op.after);
      e[i] = (e[i] ?? 0) + 1;
    }
  }
  return e;
}

function rate(errors: number, total: number): number | null {
  return total === 0 ? null : errors / total;
}

export interface TextScore {
  wer: number;
  cer: number;
  counts: ErrorCounts;
  werByLang: Record<Lang, number | null>;
  /** WER on tokens within ±2 words of a Hindi↔English switch. */
  codeSwitchWer: number | null;
  codeSwitchTokens: number;
  entityAccuracy: { overall: number | null; byType: Record<string, number | null>; total: number };
}

export function scoreText(
  ref: Reference,
  prepRef: PreparedReference,
  prepHyp: PreparedHypothesis,
): { score: TextScore; ops: Op[] } {
  const ops = align(prepRef.tokens, prepHyp.tokens);
  const counts = countErrors(ops, prepRef.tokens.length);
  const byIdx = errorsByRefIndex(ops, prepRef.tokens.length);

  const langTotals: Record<Lang, [number, number]> = { hi: [0, 0], en: [0, 0], other: [0, 0] };
  prepRef.langs.forEach((lang, i) => {
    langTotals[lang][0] += byIdx[i] ?? 0;
    langTotals[lang][1] += 1;
  });

  const window = new Set<number>();
  for (let i = 1; i < prepRef.langs.length; i++) {
    const a = prepRef.langs[i - 1];
    const b = prepRef.langs[i];
    if (a !== b && a !== 'other' && b !== 'other') {
      for (let k = i - 2; k <= i + 1; k++) if (k >= 0 && k < prepRef.langs.length) window.add(k);
    }
  }
  let csErrors = 0;
  for (const k of window) csErrors += byIdx[k] ?? 0;

  const matched = new Set<number>();
  const insertedAfter = new Set<number>();
  for (const op of ops) {
    if (op.type === 'match') matched.add(op.ref);
    if (op.type === 'ins') insertedAfter.add(op.after);
  }
  const byType: Record<string, [number, number]> = {};
  let entOk = 0;
  for (const ent of ref.entities) {
    const first = prepRef.wordTokens[ent.startWord];
    const last = prepRef.wordTokens[ent.endWord];
    if (!first || !last) continue;
    const [rs, re] = [first[0], last[1]];
    if (re <= rs) continue;
    let ok = true;
    for (let k = rs; k < re; k++) if (!matched.has(k)) ok = false;
    for (let k = rs; k < re - 1; k++) if (insertedAfter.has(k)) ok = false;
    const t = (byType[ent.type] ??= [0, 0]);
    t[1] += 1;
    if (ok) {
      t[0] += 1;
      entOk += 1;
    }
  }
  const entTotal = Object.values(byType).reduce((s, [, n]) => s + n, 0);

  return {
    ops,
    score: {
      wer: errorRate(counts),
      cer: cer(prepRef.tokens, prepHyp.tokens),
      counts,
      werByLang: {
        hi: rate(...langTotals.hi),
        en: rate(...langTotals.en),
        other: rate(...langTotals.other),
      },
      codeSwitchWer: rate(csErrors, window.size),
      codeSwitchTokens: window.size,
      entityAccuracy: {
        overall: entTotal === 0 ? null : entOk / entTotal,
        byType: Object.fromEntries(Object.entries(byType).map(([k, [ok, n]]) => [k, ok / n])),
        total: entTotal,
      },
    },
  };
}

/** Words emitted inside reference non-speech regions, per minute of non-speech. */
export function hallucinationRate(
  ref: Reference,
  hyp: PreparedHypothesis,
): { words: number; nonSpeechMinutes: number; perMinute: number | null } {
  const minutes = ref.nonSpeech.reduce((s, r) => s + Math.max(0, r.end - r.start), 0) / 60;
  let words = 0;
  for (const t of hyp.times) {
    if (!t) continue;
    const mid = (t.start + t.end) / 2;
    if (ref.nonSpeech.some((r) => mid >= r.start && mid <= r.end)) words++;
  }
  return { words, nonSpeechMinutes: minutes, perMinute: minutes === 0 ? null : words / minutes };
}

/**
 * Echo leakage: inserted `me`-lane hypothesis tokens that match a `them`-lane reference token
 * spoken within ±windowSec (remote voices picked up by the microphone).
 */
export function echoLeakage(
  meOps: readonly Op[],
  meHyp: PreparedHypothesis,
  themRef: PreparedReference,
  windowSec = 2,
): number {
  let count = 0;
  for (const op of meOps) {
    if (op.type !== 'ins') continue;
    const tok = meHyp.tokens[op.hyp];
    const time = meHyp.times[op.hyp];
    if (!tok || !time) continue;
    for (let k = 0; k < themRef.tokens.length; k++) {
      const rt = themRef.times[k];
      if (themRef.tokens[k] === tok && rt && Math.abs(rt.start - time.start) <= windowSec) {
        count++;
        break;
      }
    }
  }
  return count;
}
