const RECENT_FRAMES = 1_200;
/** A final may end inside the oldest remembered frame. */
const FRAME_SLACK_MS = 100;

/**
 * Maps time inside one STT stream (audio sent so far) to the session clock (ARCHITECTURE §5.5).
 * Frames are sent back to back, so a pause leaves a jump in `captureMs` that the provider never
 * sees; each jump is recorded as a breakpoint (also the basis for silence gating, §6.4).
 */
export class StreamTimeline {
  readonly #points: { audioMs: number; captureMs: number }[] = [];
  /** When recent audio was handed to the provider, for STT latency (§20); about 2 minutes. */
  readonly #recent: { audioEndMs: number; wallMs: number }[] = [];
  #audioMs = 0;
  #expectedCaptureMs: number | null = null;

  /** Call for every frame sent to the provider, in order. */
  sent(captureMs: number, durationMs: number, wallMs: number = Date.now()): void {
    if (this.#expectedCaptureMs === null || captureMs !== this.#expectedCaptureMs) {
      this.#points.push({ audioMs: this.#audioMs, captureMs });
    }
    this.#audioMs += durationMs;
    this.#expectedCaptureMs = captureMs + durationMs;
    this.#recent.push({ audioEndMs: this.#audioMs, wallMs });
    if (this.#recent.length > RECENT_FRAMES) this.#recent.shift();
  }

  /** Wall time at which the audio up to `audioMs` had been sent; undefined once forgotten. */
  sentAt(audioMs: number): number | undefined {
    const first = this.#recent[0];
    if (first === undefined || audioMs < first.audioEndMs - FRAME_SLACK_MS) return undefined;
    return (this.#recent.find((r) => r.audioEndMs >= audioMs) ?? this.#recent.at(-1))?.wallMs;
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
