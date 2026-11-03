import {
  ClientMessage,
  decodeAudioFrame,
  LanguageTag,
  newUlid,
  PROTOCOL_VERSION,
  Segment,
  type AudioFormat,
  type Lane,
  type ServerMessage,
} from '@meetyou/contracts';
import WebSocket from 'ws';

import type { ChunkStore } from './chunk-store.ts';
import { LaneChunker } from './lane-chunker.ts';
import { errorCode, log } from './log.ts';
import type { SttProvider, SttResult, SttStream } from './stt/types.ts';
import { StreamTimeline } from './timeline.ts';

const LANES: readonly Lane[] = ['me', 'them'];
const FRAME_MS = 100;
const STT_RETRY_MS = 5_000;

export const PCM16_FORMAT: AudioFormat = {
  codec: 'pcm16',
  sampleRate: 16000,
  channels: 1,
  frameMs: 100,
};

interface LaneStt {
  stream: SttStream | null;
  opening: Promise<void> | null;
  queued: Uint8Array[];
  timeline: StreamTimeline;
  retryAt: number;
}

/**
 * One capture session; it outlives individual WebSocket connections so reconnects resume where
 * the durable chunks end (ARCHITECTURE §5.3, §6.2).
 * TODO(S2): session state in Redis so any gateway instance can resume it (§6.2).
 */
export class StreamSession {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly #store: ChunkStore;
  readonly #stt: SttProvider | null;
  #lanes: Record<Lane, LaneChunker> | null = null;
  readonly #writes: Record<Lane, Promise<void>> = {
    me: Promise.resolve(),
    them: Promise.resolve(),
  };
  readonly #sttUpTo: Record<Lane, number> = { me: -1, them: -1 };
  readonly #laneStt: Record<Lane, LaneStt> = {
    me: { stream: null, opening: null, queued: [], timeline: new StreamTimeline(), retryAt: 0 },
    them: { stream: null, opening: null, queued: [], timeline: new StreamTimeline(), retryAt: 0 },
  };
  #socket: WebSocket | null = null;
  #ended = false;

  constructor(options: {
    sessionId: string;
    workspaceId: string;
    store: ChunkStore;
    stt: SttProvider | null;
  }) {
    this.sessionId = options.sessionId;
    this.workspaceId = options.workspaceId;
    this.#store = options.store;
    this.#stt = options.stt;
  }

  /** Binds a new connection; the first text frame must be `hello`. */
  attach(socket: WebSocket): void {
    let greeted = false;
    const helloTimer = setTimeout(() => {
      if (!greeted) this.#fail(socket, 'hello_timeout', true);
    }, 10_000);

    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        const text = data.toString();
        if (!greeted) {
          greeted = true;
          clearTimeout(helloTimer);
          void this.#hello(socket, text);
        } else {
          void this.#text(socket, text);
        }
        return;
      }
      if (this.#socket !== socket) return;
      this.#binary(socket, toBytes(data));
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (this.#socket === socket) {
        this.#socket = null;
        log('stream.disconnected', { sessionId: this.sessionId });
      }
    });
    socket.on('error', (error) => log('stream.socket_error', { code: errorCode(error) }));
  }

  async #hello(socket: WebSocket, text: string): Promise<void> {
    const parsed = parseClient(text);
    if (parsed?.type !== 'hello' || parsed.protocolVersion !== PROTOCOL_VERSION) {
      this.#fail(socket, 'bad_hello', false);
      return;
    }
    if (parsed.sessionId !== this.sessionId) {
      this.#fail(socket, 'session_mismatch', false);
      return;
    }
    if (parsed.format.codec !== 'pcm16') {
      // TODO(S1-11): Opus decode in the gateway (ADR-0003); clients fall back to PCM16.
      this.#fail(socket, 'format_unsupported', false);
      return;
    }
    if (this.#ended) {
      this.#fail(socket, 'session_ended', false);
      return;
    }

    const previous = this.#socket;
    this.#socket = socket;
    if (previous !== null && previous !== socket) previous.close(4000, 'replaced');

    try {
      const lanes = await this.#lanesReady();
      // Writes in flight from the previous connection finish first, so `durableUpTo` is final.
      await Promise.all(LANES.map((l) => this.#writes[l]));
      for (const lane of LANES) lanes[lane].dropPending();
      if (this.#socket !== socket) return;
      this.#send(socket, {
        type: 'ready',
        sessionId: this.sessionId,
        acceptedFormat: PCM16_FORMAT,
        durableUpTo: { me: lanes.me.durableUpTo, them: lanes.them.durableUpTo },
      });
      log('stream.ready', {
        sessionId: this.sessionId,
        durableMe: lanes.me.durableUpTo,
        durableThem: lanes.them.durableUpTo,
        resumeMe: parsed.resumeFrom.me,
        resumeThem: parsed.resumeFrom.them,
      });
    } catch (error: unknown) {
      log('stream.resume_failed', { sessionId: this.sessionId, code: errorCode(error) });
      this.#fail(socket, 'storage_unavailable', true);
    }
  }

  async #lanesReady(): Promise<Record<Lane, LaneChunker>> {
    if (this.#lanes === null) {
      const durable = await this.#store.durableUpTo(this.workspaceId, this.sessionId);
      this.#lanes ??= { me: new LaneChunker(durable.me), them: new LaneChunker(durable.them) };
    }
    return this.#lanes;
  }

  #binary(socket: WebSocket, bytes: Uint8Array): void {
    const lanes = this.#lanes;
    if (lanes === null) return;
    let frame;
    try {
      frame = decodeAudioFrame(bytes);
    } catch {
      this.#fail(socket, 'bad_frame', false);
      return;
    }
    const result = lanes[frame.lane].accept(frame);
    if (result === 'gap') {
      // The client replays from durableUpTo on reconnect, which closes the gap.
      this.#fail(socket, 'sequence_gap', true);
      return;
    }
    if (result === 'duplicate') return;

    if (frame.seq > this.#sttUpTo[frame.lane]) {
      this.#sttUpTo[frame.lane] = frame.seq;
      this.#forwardToStt(frame.lane, frame.payload, frame.captureMs);
    }
    this.#writeChunk(frame.lane, false);
  }

  #writeChunk(lane: Lane, force: boolean): Promise<void> {
    const lanes = this.#lanes;
    if (lanes === null) return Promise.resolve();
    const chunk = lanes[lane].take(force);
    if (chunk === null) return this.#writes[lane];
    const lastSeq = chunk.frames.at(-1)?.seq ?? -1;
    this.#writes[lane] = this.#writes[lane].then(async () => {
      try {
        await this.#store.put({
          workspaceId: this.workspaceId,
          meetingId: this.sessionId,
          lane,
          frames: chunk.frames,
          audio: chunk.audio,
          codec: 'pcm16',
        });
      } catch (error: unknown) {
        log('chunk.write_failed', { sessionId: this.sessionId, lane, code: errorCode(error) });
        const socket = this.#socket;
        if (socket !== null) this.#fail(socket, 'storage_failed', true);
        return;
      }
      lanes[lane].committed(lastSeq);
      // Acknowledged only after the durable write (§5.3), so acknowledged = safe.
      const socket = this.#socket;
      if (socket !== null) this.#send(socket, { type: 'ack', lane, upToSeq: lastSeq });
    });
    return this.#writes[lane];
  }

  async #text(socket: WebSocket, text: string): Promise<void> {
    if (this.#socket !== socket) return;
    const parsed = parseClient(text);
    if (parsed === null) {
      log('stream.bad_message', { sessionId: this.sessionId });
      return;
    }
    switch (parsed.type) {
      case 'ping':
        this.#send(socket, { type: 'pong' });
        break;
      case 'control':
        if (parsed.action === 'pause') {
          // Nothing arrives while paused, so flush now and let the client prune its buffer.
          await Promise.all(LANES.map((l) => this.#writeChunk(l, true)));
        } else if (parsed.action === 'end') {
          await this.#end(socket);
        }
        log('stream.control', { sessionId: this.sessionId, action: parsed.action, at: parsed.at });
        break;
      case 'event':
        // TODO(S1-08/S2): store normalized capture events for speaker resolution (§6.1 step 6).
        break;
      case 'hello':
        this.#fail(socket, 'duplicate_hello', false);
        break;
    }
  }

  async #end(socket: WebSocket): Promise<void> {
    this.#ended = true;
    await Promise.all(LANES.map((l) => this.#writeChunk(l, true)));
    await Promise.all(
      LANES.map(async (lane) => {
        const stt = this.#laneStt[lane];
        await stt.opening;
        const stream = stt.stream;
        stt.stream = null;
        await stream?.close();
      }),
    );
    log('stream.ended', { sessionId: this.sessionId });
    if (this.#socket === socket) socket.close(1000, 'ended');
  }

  #forwardToStt(lane: Lane, pcm: Uint8Array, captureMs: number): void {
    const provider = this.#stt;
    if (provider === null || this.#ended) return;
    const stt = this.#laneStt[lane];
    if (stt.stream !== null) {
      stt.timeline.sent(captureMs, FRAME_MS);
      stt.stream.send(pcm);
      return;
    }
    if (stt.opening === null && Date.now() < stt.retryAt) return;
    stt.queued.push(pcm);
    stt.timeline.sent(captureMs, FRAME_MS);
    if (stt.opening !== null) return;

    const timeline = stt.timeline;
    stt.opening = provider
      .open({
        onResult: (result) => this.#onSttResult(lane, timeline, result),
        onClosed: (reason) => {
          log('stt.closed', { sessionId: this.sessionId, lane, reason });
          if (stt.timeline === timeline) {
            stt.stream = null;
            stt.timeline = new StreamTimeline();
          }
        },
      })
      .then((stream) => {
        stt.stream = stream;
        for (const queued of stt.queued) stream.send(queued);
        stt.queued = [];
        log('stt.opened', { sessionId: this.sessionId, lane, provider: provider.name });
      })
      .catch((error: unknown) => {
        // Audio stays durable; transcription of this gap is left to the batch pass (§6.3).
        log('stt.open_failed', { sessionId: this.sessionId, lane, code: errorCode(error) });
        stt.queued = [];
        stt.timeline = new StreamTimeline();
        stt.retryAt = Date.now() + STT_RETRY_MS;
      })
      .finally(() => {
        stt.opening = null;
      });
  }

  #onSttResult(lane: Lane, timeline: StreamTimeline, result: SttResult): void {
    const socket = this.#socket;
    if (socket === null) return;
    const startMs = timeline.toSessionMs(result.startMs);
    if (!result.final) {
      this.#send(socket, { type: 'transcript.interim', lane, text: result.text, startMs });
      return;
    }
    const segment = Segment.safeParse({
      id: `seg_${newUlid()}`,
      workspaceId: this.workspaceId,
      meetingId: this.sessionId,
      lane,
      startMs,
      endMs: Math.max(startMs, timeline.toSessionMs(result.endMs)),
      // TODO(S3): transliterate to Roman display text (D-01, ARCHITECTURE §8.1 step 2).
      text: result.text,
      rawText: result.text,
      language: languageTag(result.language),
      source: 'live',
      words: result.words?.map((w) => ({
        text: w.text,
        startMs: timeline.toSessionMs(w.startMs),
        endMs: timeline.toSessionMs(w.endMs),
        ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
      })),
      flags: [],
    });
    if (!segment.success) {
      log('segment.invalid', {
        sessionId: this.sessionId,
        lane,
        issues: segment.error.issues.length,
      });
      return;
    }
    // TODO(S2): store segments (db) and emit segment.finalized via the outbox (§6.1 steps 4, 7).
    this.#send(socket, { type: 'transcript.segment', segment: segment.data });
  }

  #send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  #fail(socket: WebSocket, code: string, retryable: boolean): void {
    log('stream.error', { sessionId: this.sessionId, code, retryable });
    this.#send(socket, { type: 'error', code, retryable });
    socket.close(retryable ? 1011 : 1008, code);
  }
}

function parseClient(text: string): ClientMessage | null {
  try {
    const result = ClientMessage.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function toBytes(data: WebSocket.RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function languageTag(language: string | undefined): string {
  const tag = language?.toLowerCase();
  return tag !== undefined && LanguageTag.safeParse(tag).success ? tag : 'und';
}
