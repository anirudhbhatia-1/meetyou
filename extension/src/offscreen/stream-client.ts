import {
  encodeAudioFrame,
  PROTOCOL_VERSION,
  ServerMessage,
  type AudioFormat,
  type ClientMessage,
} from '@meetyou/contracts';

import type { Lane, StreamLink } from '../messages.ts';
import type { FrameStore } from './frame-store.ts';

/** The subset of the browser `WebSocket` the client uses, so tests can drive it. */
export interface SocketLike {
  binaryType: BinaryType;
  readonly bufferedAmount: number;
  send(data: string | Uint8Array<ArrayBuffer>): void;
  close(code?: number): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

export type OpenSocket = (url: string, protocols: string[]) => SocketLike;

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface StreamClientOptions {
  sessionId: string;
  streamUrl: string;
  /** Stream tokens are single use (ADR-0004 §4.4), so every connect asks for a fresh one. */
  getToken(): Promise<string>;
  /** Payload format of the frames in `store`; sent in `hello` (ADR-0003). */
  format?: AudioFormat;
  store: FrameStore;
  openSocket: OpenSocket;
  onLink(link: StreamLink): void;
  onServerMessage(message: ServerMessage): void;
  onError?(context: string, error: unknown): void;
  timers?: Timers;
  random?: () => number;
}

export const PCM16_FORMAT: AudioFormat = {
  codec: 'pcm16',
  sampleRate: 16000,
  channels: 1,
  frameMs: 100,
};

export const OPUS_FORMAT: AudioFormat = { ...PCM16_FORMAT, codec: 'opus' };

/** The gateway selects the subprotocol `minutes.v1`; the token rides alongside so it stays out of URLs and logs. */
export const SUBPROTOCOL = 'minutes.v1';
export const TOKEN_PROTOCOL_PREFIX = 'token.';

const SEND_BATCH = 50;
const HIGH_WATER_BYTES = 512 * 1024;
const PING_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

const LANES: readonly Lane[] = ['me', 'them'];

/**
 * Write-first streaming client (ARCHITECTURE §5.3): frames are already in the store when
 * `frameWritten` is called; the client sends them in order, prunes on ack, and after a reconnect
 * replays everything after the gateway's `durableUpTo`. Losing the socket never loses audio.
 */
export class StreamClient {
  readonly #o: StreamClientOptions;
  readonly #timers: Timers;
  readonly #random: () => number;
  readonly #acked: Record<Lane, number> = { me: -1, them: -1 };
  readonly #sent: Record<Lane, number> = { me: -1, them: -1 };
  readonly #written: Record<Lane, number> = { me: -1, them: -1 };
  readonly #pumping: Record<Lane, boolean> = { me: false, them: false };
  #socket: SocketLike | null = null;
  #online = false;
  #stopped = false;
  #attempt = 0;
  #reconnectTimer: unknown = null;
  #pingTimer: unknown = null;
  #waiters: (() => boolean)[] = [];
  #endSent = false;
  /** Pause/resume while offline, sent after the next `ready` so pause gaps stay known (§5.5). */
  #pendingControls: ClientMessage[] = [];

  constructor(options: StreamClientOptions) {
    this.#o = options;
    this.#timers = options.timers ?? {
      setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    this.#random = options.random ?? Math.random;
  }

  get acked(): Readonly<Record<Lane, number>> {
    return this.#acked;
  }

  /** Audio written but not yet sent, in ms of the larger lane (video uploads wait on it). */
  backlogMs(): number {
    const frameMs = this.#o.format?.frameMs ?? PCM16_FORMAT.frameMs;
    return Math.max(...LANES.map((l) => Math.max(0, this.#written[l] - this.#sent[l]))) * frameMs;
  }

  start(): void {
    void this.#connect();
  }

  /** Called after `store.put` resolved for this frame. */
  frameWritten(lane: Lane, seq: number): void {
    this.#written[lane] = Math.max(this.#written[lane], seq);
    if (this.#online) void this.#pump(lane);
  }

  control(action: 'pause' | 'resume' | 'end', at: number): void {
    const message: ClientMessage = { type: 'control', action, at };
    if (!this.#online && action !== 'end') {
      this.#pendingControls.push(message);
      return;
    }
    this.#sendJson(message);
  }

  /**
   * Ends the stream: keeps reconnecting while the link is down, sends every written frame, sends
   * `end` (the gateway then flushes its last chunk), and waits for the acks, all within
   * `timeoutMs`. A drop after `end` reconnects and ends again, so buffered audio is not abandoned
   * because the network was down at the moment the user stopped (FR-CAP-07). Frames still
   * unacknowledged at the deadline stay in the store for recovery (FR-CAP-08).
   */
  async stop(at: number, timeoutMs = 10_000): Promise<{ unacked: number }> {
    let timedOut = false;
    const timer = this.#timers.setTimeout(() => {
      timedOut = true;
      this.#wake();
    }, timeoutMs);
    const done = () => timedOut || this.#stopped;
    while (!done() && !this.#allAcked()) {
      await this.#waitUntil(() => done() || (this.#online && this.#allSent()));
      if (done()) break;
      if (!this.#endSent) {
        this.#endSent = true;
        this.control('end', at);
      }
      await this.#waitUntil(() => done() || this.#allAcked() || !this.#online);
    }
    this.#timers.clearTimeout(timer);
    this.#stopped = true;
    this.#waiters = [];
    this.#timers.clearTimeout(this.#reconnectTimer);
    this.#timers.clearTimeout(this.#pingTimer);
    this.#socket?.close(1000);
    this.#socket = null;
    this.#online = false;
    this.#o.onLink('off');
    return {
      unacked: LANES.reduce((n, l) => n + Math.max(0, this.#written[l] - this.#acked[l]), 0),
    };
  }

  #allSent(): boolean {
    return LANES.every((l) => this.#sent[l] >= this.#written[l]);
  }

  #allAcked(): boolean {
    return LANES.every((l) => this.#acked[l] >= this.#written[l]);
  }

  #waitUntil(predicate: () => boolean): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve) => {
      this.#waiters.push(() => {
        if (!predicate()) return false;
        resolve();
        return true;
      });
    });
  }

  /** Re-checks pending waits after progress (send, ack, disconnect, timeout). */
  #wake(): void {
    this.#waiters = this.#waiters.filter((check) => !check());
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;
    this.#o.onLink(this.#attempt === 0 ? 'connecting' : 'reconnecting');
    let token: string;
    try {
      token = await this.#o.getToken();
    } catch (error: unknown) {
      this.#o.onError?.('stream token failed', error);
      this.#scheduleReconnect();
      return;
    }
    if (this.#stopped) return;
    const socket = this.#o.openSocket(this.#o.streamUrl, [
      SUBPROTOCOL,
      `${TOKEN_PROTOCOL_PREFIX}${token}`,
    ]);
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;
    socket.onopen = () => {
      this.#sendJson({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: this.#o.sessionId,
        resumeFrom: { me: this.#acked.me, them: this.#acked.them },
        format: this.#o.format ?? PCM16_FORMAT,
      });
    };
    socket.onmessage = (event) => this.#onMessage(event.data as unknown);
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#online = false;
      this.#timers.clearTimeout(this.#pingTimer);
      this.#wake();
      // After a completed `end` the gateway closes the session and a reconnect would be refused;
      // a drop before every frame was acknowledged reconnects and ends again.
      if (!this.#endSent || !this.#allAcked()) {
        this.#endSent = false;
        this.#scheduleReconnect();
      }
    };
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    this.#attempt += 1;
    this.#o.onLink('reconnecting');
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(this.#attempt, 6));
    const delay = Math.round(base * (0.5 + this.#random() / 2));
    this.#reconnectTimer = this.#timers.setTimeout(() => void this.#connect(), delay);
  }

  #onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let parsed: ServerMessage;
    try {
      const result = ServerMessage.safeParse(JSON.parse(data));
      if (!result.success) {
        this.#o.onError?.('unknown gateway message', result.error.issues.length);
        return;
      }
      parsed = result.data;
    } catch (error: unknown) {
      this.#o.onError?.('gateway message not JSON', error);
      return;
    }

    switch (parsed.type) {
      case 'ready':
        this.#attempt = 0;
        this.#online = true;
        for (const lane of LANES) {
          void this.#acknowledge(lane, parsed.durableUpTo[lane]);
          this.#sent[lane] = parsed.durableUpTo[lane];
        }
        this.#o.onLink('online');
        this.#schedulePing();
        for (const message of this.#pendingControls.splice(0)) this.#sendJson(message);
        for (const lane of LANES) void this.#pump(lane);
        break;
      case 'ack':
        void this.#acknowledge(parsed.lane, parsed.upToSeq);
        break;
      case 'error':
        this.#o.onError?.(`gateway error ${parsed.code}`, parsed.retryable);
        if (!parsed.retryable) {
          this.#stopped = true;
          this.#wake();
          this.#socket?.close(1000);
          this.#o.onLink('off');
        }
        break;
      default:
        this.#o.onServerMessage(parsed);
    }
  }

  async #acknowledge(lane: Lane, upToSeq: number): Promise<void> {
    if (upToSeq <= this.#acked[lane]) return;
    this.#acked[lane] = upToSeq;
    this.#wake();
    try {
      await this.#o.store.prune(lane, upToSeq);
    } catch (error: unknown) {
      this.#o.onError?.('buffer prune failed', error);
    }
  }

  async #pump(lane: Lane): Promise<void> {
    if (this.#pumping[lane]) return;
    this.#pumping[lane] = true;
    try {
      while (this.#online && this.#sent[lane] < this.#written[lane]) {
        const socket = this.#socket;
        if (socket === null) break;
        const batch = await this.#o.store.after(lane, this.#sent[lane], SEND_BATCH);
        if (batch.length === 0) break;
        for (const frame of batch) {
          if (!this.#online || this.#socket !== socket) return;
          socket.send(encodeAudioFrame(frame) as Uint8Array<ArrayBuffer>);
          this.#sent[lane] = frame.seq;
        }
        this.#wake();
        while (this.#online && socket.bufferedAmount > HIGH_WATER_BYTES) {
          await new Promise<void>((resolve) => this.#timers.setTimeout(resolve, 50));
        }
      }
    } catch (error: unknown) {
      this.#o.onError?.('buffer read failed', error);
    } finally {
      this.#pumping[lane] = false;
    }
  }

  #schedulePing(): void {
    this.#timers.clearTimeout(this.#pingTimer);
    this.#pingTimer = this.#timers.setTimeout(() => {
      this.#sendJson({ type: 'ping' });
      if (this.#online) this.#schedulePing();
    }, PING_MS);
  }

  #sendJson(message: ClientMessage): void {
    if (this.#socket !== null && (this.#online || message.type === 'hello')) {
      this.#socket.send(JSON.stringify(message));
    }
  }
}
