/**
 * Maps time inside one STT stream (audio sent so far) to the session clock (ARCHITECTURE §5.5).
 * Frames are sent back to back, so a pause leaves a jump in `captureMs` that the provider never
 * sees; each jump is recorded as a breakpoint (also the basis for silence gating, §6.4).
 */
export class StreamTimeline {
  readonly #points: { audioMs: number; captureMs: number }[] = [];
  #audioMs = 0;
  #expectedCaptureMs: number | null = null;

  /** Call for every frame sent to the provider, in order. */
  sent(captureMs: number, durationMs: number): void {
    if (this.#expectedCaptureMs === null || captureMs !== this.#expectedCaptureMs) {
      this.#points.push({ audioMs: this.#audioMs, captureMs });
    }
    this.#audioMs += durationMs;
    this.#expectedCaptureMs = captureMs + durationMs;
  }

  toSessionMs(audioMs: number): number {
    let point = this.#points[0];
    if (point === undefined) return Math.max(0, Math.round(audioMs));
    for (const p of this.#points) {
      if (p.audioMs > audioMs) break;
      point = p;
    }
    return Math.max(0, Math.round(point.captureMs + (audioMs - point.audioMs)));
  }
}
