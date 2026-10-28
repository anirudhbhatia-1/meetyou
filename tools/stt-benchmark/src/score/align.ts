export type Op =
  | { type: 'match'; ref: number; hyp: number }
  | { type: 'sub'; ref: number; hyp: number }
  | { type: 'del'; ref: number }
  | {
      type: 'ins';
      hyp: number;
      /** reference index the insertion follows (-1 = before first). */ after: number;
    };

/** Levenshtein alignment of token sequences with backtrace (ties prefer match/sub, then del). */
export function align(ref: readonly string[], hyp: readonly string[]): Op[] {
  const n = ref.length;
  const m = hyp.length;
  const w = m + 1;
  const cost = new Uint32Array((n + 1) * w);
  const back = new Uint8Array((n + 1) * w); // 0 diag, 1 del (up), 2 ins (left)
  for (let i = 1; i <= n; i++) {
    cost[i * w] = i;
    back[i * w] = 1;
  }
  for (let j = 1; j <= m; j++) {
    cost[j] = j;
    back[j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = (cost[(i - 1) * w + (j - 1)] ?? 0) + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      const up = (cost[(i - 1) * w + j] ?? 0) + 1;
      const left = (cost[i * w + (j - 1)] ?? 0) + 1;
      let best = diag;
      let dir = 0;
      if (up < best) {
        best = up;
        dir = 1;
      }
      if (left < best) {
        best = left;
        dir = 2;
      }
      cost[i * w + j] = best;
      back[i * w + j] = dir;
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = back[i * w + j];
    if (i > 0 && j > 0 && dir === 0) {
      ops.push({ type: ref[i - 1] === hyp[j - 1] ? 'match' : 'sub', ref: i - 1, hyp: j - 1 });
      i--;
      j--;
    } else if (i > 0 && (dir === 1 || j === 0)) {
      ops.push({ type: 'del', ref: i - 1 });
      i--;
    } else {
      ops.push({ type: 'ins', hyp: j - 1, after: i - 1 });
      j--;
    }
  }
  return ops.reverse();
}

export interface ErrorCounts {
  sub: number;
  del: number;
  ins: number;
  refLength: number;
}

export function countErrors(ops: readonly Op[], refLength: number): ErrorCounts {
  const c = { sub: 0, del: 0, ins: 0, refLength };
  for (const op of ops) if (op.type !== 'match') c[op.type]++;
  return c;
}

export function errorRate(c: ErrorCounts): number {
  if (c.refLength === 0) return c.ins === 0 ? 0 : 1;
  return (c.sub + c.del + c.ins) / c.refLength;
}

/** Character edit distance with two rows (for CER on long texts). */
export function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = new Uint32Array(y.length + 1).map((_, j) => j);
  let curr = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const sub = (prev[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1);
      curr[j] = Math.min(sub, (prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[y.length] ?? 0;
}

export function cer(refTokens: readonly string[], hypTokens: readonly string[]): number {
  const r = refTokens.join(' ');
  const h = hypTokens.join(' ');
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return editDistance(r, h) / Array.from(r).length;
}
