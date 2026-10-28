export interface Turn {
  speaker: string;
  start: number;
  end: number;
}

const FRAME = 0.01; // seconds

function framesBySpeaker(turns: readonly Turn[], nFrames: number): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  for (const t of turns) {
    let arr = m.get(t.speaker);
    if (!arr) m.set(t.speaker, (arr = new Uint8Array(nFrames)));
    const a = Math.max(0, Math.floor(t.start / FRAME));
    const b = Math.min(nFrames, Math.ceil(t.end / FRAME));
    arr.fill(1, a, b);
  }
  return m;
}

/** Best one-to-one mapping hyp→ref by overlap (exhaustive search; fine for ≤ 8 speakers). */
function bestMapping(overlap: number[][]): number[] {
  const nh = overlap.length;
  const nr = overlap[0]?.length ?? 0;
  let best = -1;
  let bestMap: number[] = new Array<number>(nh).fill(-1);
  const used = new Array<boolean>(nr).fill(false);
  const current = new Array<number>(nh).fill(-1);
  const search = (h: number, score: number) => {
    if (h === nh) {
      if (score > best) {
        best = score;
        bestMap = [...current];
      }
      return;
    }
    current[h] = -1;
    search(h + 1, score);
    for (let r = 0; r < nr; r++) {
      if (used[r]) continue;
      used[r] = true;
      current[h] = r;
      search(h + 1, score + (overlap[h]?.[r] ?? 0));
      used[r] = false;
    }
    current[h] = -1;
  };
  search(0, 0);
  return bestMap;
}

/**
 * Frame-based diarization error rate with a no-score collar around reference boundaries
 * (STT_BENCHMARK_PLAN §6.2). Error per frame = max(nRef, nHyp) − nCorrect.
 */
export function diarizationErrorRate(
  ref: readonly Turn[],
  hyp: readonly Turn[],
  collarSec = 0.25,
): { der: number | null; scoredSeconds: number; refSpeakers: number; hypSpeakers: number } {
  const end = Math.max(0, ...ref.map((t) => t.end), ...hyp.map((t) => t.end));
  const n = Math.ceil(end / FRAME) + 1;
  const refF = framesBySpeaker(ref, n);
  const hypF = framesBySpeaker(hyp, n);
  const refIds = [...refF.keys()];
  const hypIds = [...hypF.keys()];

  const scored = new Uint8Array(n).fill(1);
  const c = Math.round(collarSec / FRAME);
  for (const t of ref) {
    for (const edge of [t.start, t.end]) {
      const f = Math.round(edge / FRAME);
      scored.fill(0, Math.max(0, f - c), Math.min(n, f + c + 1));
    }
  }

  const overlap = hypIds.map((h) =>
    refIds.map((r) => {
      const a = hypF.get(h);
      const b = refF.get(r);
      let s = 0;
      if (a && b) for (let i = 0; i < n; i++) if (scored[i] && a[i] && b[i]) s++;
      return s;
    }),
  );
  const mapping = bestMapping(overlap);

  let errors = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (!scored[i]) continue;
    let nRef = 0;
    let nHyp = 0;
    let correct = 0;
    refIds.forEach((r) => (nRef += refF.get(r)?.[i] ?? 0));
    hypIds.forEach((h, hi) => {
      if (hypF.get(h)?.[i]) {
        nHyp++;
        const r = mapping[hi] ?? -1;
        if (r >= 0 && refF.get(refIds[r] ?? '')?.[i]) correct++;
      }
    });
    errors += Math.max(nRef, nHyp) - correct;
    total += nRef;
  }
  return {
    der: total === 0 ? null : errors / total,
    scoredSeconds: total * FRAME,
    refSpeakers: refIds.length,
    hypSpeakers: hypIds.length,
  };
}

/** Groups consecutive words with the same speaker label into turns. */
export function turnsFromWords(
  words: readonly { start?: number; end?: number; speaker?: string }[],
): Turn[] {
  const turns: Turn[] = [];
  for (const w of words) {
    if (w.start === undefined || w.end === undefined || w.speaker === undefined) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === w.speaker && w.start - last.end < 1) last.end = w.end;
    else turns.push({ speaker: w.speaker, start: w.start, end: w.end });
  }
  return turns;
}
