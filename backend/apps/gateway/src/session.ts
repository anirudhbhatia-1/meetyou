import { randomInt } from 'node:crypto';

import {
  ClientMessage,
  decodeAudioFrame,
  LanguageTag,
  newUlid,
  OPUS_PACKET_MS,
  PROTOCOL_VERSION,
  Segment,
  unpackOpusFrame,
  type AudioFormat,
  type AudioFrame,
  type Lane,
  type ServerMessage,
} from '@meetyou/contracts';
import WebSocket from 'ws';

import type { ChunkStore } from './chunk-store.ts';
import { EchoDetector } from './echo.ts';
import { LaneChunker, type PendingChunk } from './lane-chunker.ts';
import { errorCode, log } from './log.ts';
import { oggOpusFile, OggOpusWriter } from './ogg.ts';
import { clusterId, splitBySpeaker, type SpeakerRun } from './speakers.ts';
import type { SttProvider, SttResult, SttStream } from './stt/types.ts';
import { StreamTimeline } from './timeline.ts';
import { UsageMeter } from './usage.ts';

const LANES: readonly Lane[] = ['me', 'them'];
const STT_RETRY_MS = 5_000;
/** 16 kHz × 2 bytes per sample. */
const PCM16_BYTES_PER_MS = 32;

type Codec = AudioFormat['codec'];

function formatFor(codec: Codec): AudioFormat {
  return { codec, sampleRate: 16000, channels: 1, frameMs: 100 };
}

interface LaneStt {
  stream: SttStream | null;
  opening: Promise<void> | null;
  queued: { bytes: Uint8Array; durationMs: number }[];
  timeline: StreamTimeline;
  /** Per provider stream: Opus packets are wrapped in a fresh Ogg stream (ADR-0003). */
  ogg: OggOpusWriter | null;
  retryAt: number;
}

function newLaneStt(): LaneStt {
  return {
    stream: null,
    opening: null,
    queued: [],
    timeline: new StreamTimeline(),
    ogg: null,
    retryAt: 0,
  };
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
  readonly #meter: UsageMeter;
  readonly #echo = new EchoDetector();
  #codec: Codec | null = null;
  #lanes: Record<Lane, LaneChunker> | null = null;
  readonly #writes: Record<Lane, Promise<void>> = {
    me: Promise.resolve(),
    them: Promise.resolve(),
  };
  readonly #sttUpTo: Record<Lane, number> = { me: -1, them: -1 };
  readonly #laneStt: Record<Lane, LaneStt> = { me: newLaneStt(), them: newLaneStt() };
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
    this.#meter = new UsageMeter({
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
      provider: options.stt?.name ?? null,
      usdPerMinute: options.stt?.usdPerMinute ?? null,
    });
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
        void this.#saveUsage();
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
    // Stored chunks and open STT streams use one codec, so a session keeps the codec it began with.
    if (this.#codec !== null && parsed.format.codec !== this.#codec) {
      this.#fail(socket, 'format_changed', false);
      return;
    }
    if (this.#ended) {
      this.#fail(socket, 'session_ended', false);
      return;
    }
    this.#codec = parsed.format.codec;

    const previous = this.#socket;
    this.#socket = socket;
    if (previous !== null && previous !== socket) previous.close(4000, 'replaced');

    try {
      const lanes = await this.#lanesReady();
      // Writes in flight from the previous connection finish first, so `durableUpTo` is final.
      await Promise.all(LANES.map((l) => this.#writes[l]));
      for (const lane of LANES) lanes[lane].dropPending();
      if (this.#socket !== socket) return;
      this.#meter.connected(this.#codec);
      this.#send(socket, {
        type: 'ready',
        sessionId: this.sessionId,
        acceptedFormat: formatFor(this.#codec),
        durableUpTo: { me: lanes.me.durableUpTo, them: lanes.them.durableUpTo },
      });
      log('stream.ready', {
        sessionId: this.sessionId,
        codec: this.#codec,
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
    let frame: AudioFrame;
    let packets: Uint8Array[] | null = null;
    let durationMs: number;
    try {
      frame = decodeAudioFrame(bytes);
      if (this.#codec === 'opus') {
        packets = unpackOpusFrame(frame.payload);
        durationMs = packets.length * OPUS_PACKET_MS;
      } else {
        if (frame.payload.byteLength % PCM16_BYTES_PER_MS !== 0) throw new RangeError('PCM size');
        durationMs = frame.payload.byteLength / PCM16_BYTES_PER_MS;
      }
    } catch {
      this.#fail(socket, 'bad_frame', false);
      return;
    }
    const result = lanes[frame.lane].accept(frame, durationMs);
    if (result === 'gap') {
      // The client replays from durableUpTo on reconnect, which closes the gap.
      this.#fail(socket, 'sequence_gap', true);
      return;
    }
    if (result === 'duplicate') {
      this.#meter.duplicate();
      return;
    }
    this.#meter.frame(frame.lane);

    if (frame.seq > this.#sttUpTo[frame.lane]) {
      this.#sttUpTo[frame.lane] = frame.seq;
      this.#forwardToStt(frame.lane, frame.payload, packets, frame.captureMs, durationMs);
    }
    this.#writeChunk(frame.lane, false);
  }

  #chunkAudio(chunk: PendingChunk): Uint8Array {
    if (this.#codec === 'opus') {
      return oggOpusFile(
        chunk.payloads.flatMap((p) => unpackOpusFrame(p)),
        { serial: randomInt(0, 2 ** 32) },
      );
    }
    return Buffer.concat(chunk.payloads);
  }

  #writeChunk(lane: Lane, force: boolean): Promise<void> {
    const lanes = this.#lanes;
    if (lanes === null) return Promise.resolve();
    const chunk = lanes[lane].take(force);
    if (chunk === null) return this.#writes[lane];
    const lastSeq = chunk.frames.at(-1)?.seq ?? -1;
    const codec = this.#codec ?? 'pcm16';
    this.#writes[lane] = this.#writes[lane].then(async () => {
      try {
        const audio = this.#chunkAudio(chunk);
        await this.#store.put({
          workspaceId: this.workspaceId,
          meetingId: this.sessionId,
          lane,
          frames: chunk.frames,
          audio,
          codec,
        });
        this.#meter.chunk(
          lane,
          audio.byteLength,
          chunk.frames.reduce((n, f) => n + f.durationMs, 0),
        );
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
    const usage = await this.#saveUsage();
    log('stream.ended', {
      sessionId: this.sessionId,
      audioMsMe: usage.audioMs.me,
      audioMsThem: usage.audioMs.them,
      sttMsMe: usage.stt.audioMs.me,
      sttMsThem: usage.stt.audioMs.them,
      bytesStored: usage.bytesStored,
      estimatedCostUsd: usage.estimatedCostUsd,
    });
    if (this.#socket === socket) socket.close(1000, 'ended');
  }

  async #saveUsage() {
    const usage = this.#meter.snapshot();
    try {
      await this.#store.putUsage(usage);
    } catch (error: unknown) {
      log('usage.write_failed', { sessionId: this.sessionId, code: errorCode(error) });
    }
    return usage;
  }

  #forwardToStt(
    lane: Lane,
    payload: Uint8Array,
    packets: Uint8Array[] | null,
    captureMs: number,
    durationMs: number,
  ): void {
    const provider = this.#stt;
    if (provider === null || this.#ended) return;
    const stt = this.#laneStt[lane];
    if (stt.stream === null && stt.opening === null && Date.now() < stt.retryAt) return;

    const opening = stt.stream === null && stt.opening === null;
    if (opening) {
      stt.timeline = new StreamTimeline();
      stt.ogg = packets === null ? null : new OggOpusWriter({ serial: randomInt(0, 2 ** 32) });
      if (stt.ogg !== null) stt.queued.push({ bytes: stt.ogg.headers(), durationMs: 0 });
    }
    const bytes = packets !== null && stt.ogg !== null ? stt.ogg.packets(packets) : payload;
    stt.timeline.sent(captureMs, durationMs);

    if (stt.stream !== null) {
      stt.stream.send(bytes);
      this.#meter.sttSent(lane, durationMs);
      return;
    }
    stt.queued.push({ bytes, durationMs });
    if (!opening) return;

    const timeline = stt.timeline;
    stt.opening = provider
      .open(
        packets === null ? 'pcm16' : 'ogg_opus',
        {
          onResult: (result) => this.#onSttResult(lane, timeline, result),
          onClosed: (reason) => {
            log('stt.closed', { sessionId: this.sessionId, lane, reason });
            if (stt.timeline === timeline) stt.stream = null;
          },
        },
        { diarize: lane === 'them' },
      )
      .then((stream) => {
        stt.stream = stream;
        for (const queued of stt.queued) {
          stream.send(queued.bytes);
          this.#meter.sttSent(lane, queued.durationMs);
        }
        stt.queued = [];
        this.#meter.sttStreamOpened();
        log('stt.opened', { sessionId: this.sessionId, lane, provider: provider.name });
      })
      .catch((error: unknown) => {
        // Audio stays durable; transcription of this gap is left to the batch pass (§6.3).
        log('stt.open_failed', { sessionId: this.sessionId, lane, code: errorCode(error) });
        stt.queued = [];
        stt.retryAt = Date.now() + STT_RETRY_MS;
      })
      .finally(() => {
        stt.opening = null;
      });
  }

  #onSttResult(lane: Lane, timeline: StreamTimeline, result: SttResult): void {
    if (!result.final) {
      const socket = this.#socket;
      if (socket !== null) {
        const startMs = timeline.toSessionMs(result.startMs);
        this.#send(socket, { type: 'transcript.interim', lane, text: result.text, startMs });
      }
      return;
    }
    // One segment per diarized speaker run (FR-SPK-02); `me` is never diarized.
    for (const run of splitBySpeaker(result)) {
      this.#finalSegment(lane, timeline, run, result.language);
    }
  }

  #finalSegment(
    lane: Lane,
    timeline: StreamTimeline,
    run: SpeakerRun,
    language: string | undefined,
  ): void {
    const startMs = timeline.toSessionMs(run.startMs);
    const endMs = Math.max(startMs, timeline.toSessionMs(run.endMs));
    const echo = this.#echo.check(lane, startMs, endMs, run.text);
    this.#meter.segment(lane, echo);
    const socket = this.#socket;
    if (socket === null) return;
    const speakerClusterId = lane === 'them' ? clusterId(run.speaker) : undefined;
    const segment = Segment.safeParse({
      id: `seg_${newUlid()}`,
      workspaceId: this.workspaceId,
      meetingId: this.sessionId,
      lane,
      // TODO(S3-04): cluster IDs restart with each provider stream; batch resolution unifies them.
      ...(speakerClusterId !== undefined ? { speakerClusterId } : {}),
      startMs,
      endMs,
      // TODO(S3): transliterate to Roman display text (D-01, ARCHITECTURE §8.1 step 2).
      text: run.text,
      rawText: run.text,
      language: languageTag(language),
      source: 'live',
      words: run.words.map((w) => ({
        text: w.text,
        startMs: timeline.toSessionMs(w.startMs),
        endMs: timeline.toSessionMs(w.endMs),
        ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
      })),
      flags: echo.flag ? ['echo'] : [],
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
