/**
 * Per-session latency histograms (ARCHITECTURE §20: STT final latency, ack lag). Fixed buckets keep
 * memory constant for a 60-minute session; a percentile is reported as its bucket's upper edge,
 * so it is an upper bound accurate to the bucket width.
 */
const EDGES_MS = [50, 100, 200, 300, 500, 750, 1_000, 1_500, 2_000, 3_000, 5_000, 10_000, 30_000];

export class LatencyHistogram {
  readonly #counts = new Array<number>(EDGES_MS.length + 1).fill(0);
  #total = 0;
  #maxMs = 0;

  add(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    let i = EDGES_MS.findIndex((edge) => ms <= edge);
    if (i === -1) i = EDGES_MS.length;
    this.#counts[i] = (this.#counts[i] ?? 0) + 1;
    this.#total += 1;
    this.#maxMs = Math.max(this.#maxMs, Math.round(ms));
  }

  get count(): number {
    return this.#total;
  }

  /** Upper edge of the bucket holding the `p`-th percentile (0–100); the max for the last one. */
  percentile(p: number): number | undefined {
    if (this.#total === 0) return undefined;
    const rank = Math.ceil((p / 100) * this.#total);
    let seen = 0;
    for (const [i, n] of this.#counts.entries()) {
      seen += n;
      if (seen >= rank) return Math.min(EDGES_MS[i] ?? this.#maxMs, this.#maxMs);
    }
    return this.#maxMs;
  }
}
