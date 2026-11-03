import { rmsDbfs } from './levels.ts';

/** STT input format (FR-CAP-05, ARCHITECTURE §5.2): 16 kHz mono PCM16 in 100 ms frames. */
export const SAMPLE_RATE = 16_000;
export const FRAME_SAMPLES = 1_600;

export interface PcmFrame {
  pcm: Int16Array;
  /** Audio-context sample frame of the first sample, used to place the frame on the session clock. */
  startFrame: number;
  levelDbfs: number;
}

export function floatToPcm16(sample: number): number {
  const s = Math.max(-1, Math.min(1, Number.isNaN(sample) ? 0 : sample));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

/**
 * Collects render quanta into fixed frames. Multi-channel input is averaged to mono; no input (a
 * disconnected source) counts as silence so the lane clock never drifts.
 */
export class PcmFramer {
  readonly #frameSamples: number;
  readonly #buffer: Float32Array<ArrayBuffer>;
  #filled = 0;
  #frameStart = 0;

  constructor(frameSamples: number = FRAME_SAMPLES) {
    this.#frameSamples = frameSamples;
    this.#buffer = new Float32Array(frameSamples);
  }

  push(channels: readonly Float32Array[], quantumStartFrame: number, length: number): PcmFrame[] {
    const out: PcmFrame[] = [];
    for (let i = 0; i < length; i++) {
      if (this.#filled === 0) this.#frameStart = quantumStartFrame + i;
      let sum = 0;
      for (const channel of channels) sum += channel[i] ?? 0;
      this.#buffer[this.#filled++] = channels.length === 0 ? 0 : sum / channels.length;
      if (this.#filled === this.#frameSamples) {
        const pcm = new Int16Array(this.#frameSamples);
        for (let j = 0; j < this.#frameSamples; j++) pcm[j] = floatToPcm16(this.#buffer[j] ?? 0);
        out.push({ pcm, startFrame: this.#frameStart, levelDbfs: rmsDbfs(this.#buffer) });
        this.#filled = 0;
      }
    }
    return out;
  }
}

/** Session-clock milliseconds of a frame, given the sample frame at which the session began. */
export function captureMsFor(startFrame: number, sessionStartFrame: number): number {
  return Math.max(0, Math.round(((startFrame - sessionStartFrame) * 1000) / SAMPLE_RATE));
}
