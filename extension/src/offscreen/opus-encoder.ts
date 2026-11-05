import { OPUS_PACKET_MS } from '@meetyou/contracts';

/**
 * Opus transport for both lanes (ADR-0003): 24 kbps mono at 16 kHz, 20 ms packets, grouped into
 * the 100 ms protocol frames. WebCodecs `AudioEncoder` is built into Chrome, so no WASM encoder is
 * shipped. `application`/`signal` are in the W3C Opus registration but not yet in TypeScript's DOM
 * types; `voip` matches the ADR-0003 Phase D encoding.
 */
export const OPUS_ENCODER_CONFIG: AudioEncoderConfig & {
  opus: OpusEncoderConfig & { application: 'voip'; signal: 'voice' };
} = {
  codec: 'opus',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitrate: 24_000,
  opus: {
    format: 'opus',
    frameDuration: OPUS_PACKET_MS * 1000,
    application: 'voip',
    signal: 'voice',
  },
};

const PACKETS_PER_FRAME = 5;
/** Encoder output timestamps may drift by rounding; anything beyond this is a real gap (pause). */
const CONTIGUOUS_TOLERANCE_US = 2_000;

export interface OpusGroup {
  packets: Uint8Array[];
  captureMs: number;
  durationMs: number;
}

/**
 * Groups encoder packets into protocol frames: five consecutive 20 ms packets, or fewer when the
 * timeline jumps (a pause drops input, so the next packet starts later) or at the end.
 */
export class OpusFrameGrouper {
  #packets: Uint8Array[] = [];
  #startUs = 0;
  #nextUs = 0;
  #durationUs = 0;

  push(packet: Uint8Array, timestampUs: number, durationUs: number): OpusGroup[] {
    const out: OpusGroup[] = [];
    if (
      this.#packets.length > 0 &&
      Math.abs(timestampUs - this.#nextUs) > CONTIGUOUS_TOLERANCE_US
    ) {
      out.push(this.#take());
    }
    if (this.#packets.length === 0) this.#startUs = timestampUs;
    this.#packets.push(packet);
    this.#durationUs += durationUs;
    this.#nextUs = timestampUs + durationUs;
    if (this.#packets.length === PACKETS_PER_FRAME) out.push(this.#take());
    return out;
  }

  flush(): OpusGroup[] {
    return this.#packets.length === 0 ? [] : [this.#take()];
  }

  #take(): OpusGroup {
    const group = {
      packets: this.#packets,
      captureMs: Math.round(this.#startUs / 1000),
      durationMs: Math.round(this.#durationUs / 1000),
    };
    this.#packets = [];
    this.#durationUs = 0;
    return group;
  }
}

export interface LaneEncoder {
  /** One 100 ms PCM16 frame at its session-clock time. */
  encode(pcm: Int16Array<ArrayBuffer>, captureMs: number): void;
  /** Emits everything still buffered (call before stopping). */
  flush(): Promise<void>;
  close(): void;
}

/** Bounded so a persistently failing encoder does not restart in a loop. */
const MAX_ENCODER_RESTARTS = 5;

/** Returns null when this Chrome cannot encode the config; the caller falls back to PCM16. */
export async function createLaneEncoder(options: {
  onFrame(group: OpusGroup): void;
  onError(context: string, error: unknown): void;
}): Promise<LaneEncoder | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  try {
    const support = await AudioEncoder.isConfigSupported(OPUS_ENCODER_CONFIG);
    if (support.supported !== true) return null;
  } catch (error: unknown) {
    options.onError('opus config check failed', error);
    return null;
  }

  const grouper = new OpusFrameGrouper();
  let restarts = 0;
  let closed = false;
  // An encoder error closes the AudioEncoder for good; without a restart the lane would go silent
  // for the rest of the meeting while still reported as captured.
  const create = (): AudioEncoder => {
    const next = new AudioEncoder({
      output(chunk) {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        const durationUs = chunk.duration ?? OPUS_PACKET_MS * 1000;
        for (const group of grouper.push(bytes, chunk.timestamp, durationUs)) {
          options.onFrame(group);
        }
      },
      error(error) {
        options.onError('opus encoder error', error);
        if (closed || restarts >= MAX_ENCODER_RESTARTS) return;
        restarts += 1;
        encoder = create();
      },
    });
    next.configure(OPUS_ENCODER_CONFIG);
    return next;
  };
  let encoder = create();

  return {
    encode(pcm, captureMs) {
      if (encoder.state !== 'configured') return;
      const data = new AudioData({
        format: 's16',
        sampleRate: OPUS_ENCODER_CONFIG.sampleRate,
        numberOfFrames: pcm.length,
        numberOfChannels: 1,
        timestamp: captureMs * 1000,
        data: pcm,
      });
      try {
        encoder.encode(data);
      } finally {
        data.close();
      }
    },
    async flush() {
      if (encoder.state === 'configured') await encoder.flush();
      for (const group of grouper.flush()) options.onFrame(group);
    },
    close() {
      closed = true;
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}
