import { randomInt } from 'node:crypto';

import {
  ClientMessage,
  decodeAudioFrame,
  OPUS_PACKET_MS,
  PROTOCOL_VERSION,
  unpackOpusFrame,
  type AudioFormat,
  type AudioFrame,
  type CaptureEvent,
  type Lane,
  type ServerMessage,
} from '@meetyou/contracts';
import { recordSpan } from '@meetyou/tracing';
import WebSocket from 'ws';

import type { DisplayTextPolicy } from '@meetyou/hinglish';

import { TranscriptAssembler } from './assembler.ts';
import type { ChunkStore } from './chunk-store.ts';
import { LatencyHistogram } from './latency.ts';
import { LaneChunker, type PendingChunk } from './lane-chunker.ts';
import { errorCode, log } from './log.ts';
import { DEFAULT_PRE_SKIP, oggOpusFile, OggOpusWriter } from '@meetyou/storage';
import type { SttProvider, SttResult, SttStream } from '@meetyou/providers';
import type { SessionPatch } from './registry.ts';
import { FileSink, type SessionSink, type SessionTarget } from './sinks.ts';
import { StreamTimeline } from './timeline.ts';
import { UsageMeter } from './usage.ts';

const LANES: readonly Lane[] = ['me', 'them'];
const STT_RETRY_MS = 5_000;
/** ~60 s of audio per lane waits for a provider stream that is still opening; older is dropped. */
const MAX_STT_QUEUE = 600;
/** Without a client for this long, the lane STT streams close (they reopen on the next frame). */
export const STT_IDLE_CLOSE_MS = 60_000;
/** 16 kHz × 2 bytes per sample. */
const PCM16_BYTES_PER_MS = 32;
/** After this many provider opens fail in a row, live STT counts as down (ws-protocol `health`). */
export const STT_DOWN_AFTER_FAILURES = 3;
/** A lane counts as receiving while a frame arrived within this window. */
const RECEIVING_WINDOW_MS = 5_000;

type SttHealth = 'ok' | 'degraded' | 'down';

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
 * the durable chunks end (ARCHITECTURE §5.3, §6.2). Its record lives in the session registry
 * (Redis when deployed), so any gateway instance can take it over and resume.
 */
export class StreamSession {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly meetingId: string;
  readonly #store: ChunkStore;
  readonly #stt: SttProvider | null;
  readonly #meter: UsageMeter;
  /** §20: provider final latency and durable-write (ack) latency, logged when the session ends. */
  readonly #sttFinalLatency = new LatencyHistogram();
  readonly #ackLag = new LatencyHistogram();
  readonly #assembler: TranscriptAssembler;
  readonly #sink: SessionSink;
  /** Sink writes in order; a failure is logged and the chain goes on (the batch pass re-covers it). */
  #sinkWrites: Promise<void> = Promise.resolve();
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
  /** A chunk write failed: later chunks of the lane are not written or acked until a new hello. */
  readonly #writeFailed: Record<Lane, boolean> = { me: false, them: false };
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #lastActivityAt = Date.now();
  readonly #onEnded: (() => void) | undefined;
  readonly #onState: (patch: SessionPatch) => void;
  readonly #keyterms: readonly string[];
  #sttHealth: SttHealth = 'ok';
  #openFailures = 0;
  #needsBatch = false;
  readonly #lastFrameAt: Record<Lane, number> = { me: 0, them: 0 };

  constructor(options: {
    sessionId: string;
    workspaceId: string;
    /** The meeting the session records into; the session ID itself without a database. */
    meetingId?: string;
    store: ChunkStore;
    stt: SttProvider | null;
    /** Defaults to files next to the audio (local dev). */
    sink?: SessionSink;
    /** Display text policy (assembler.ts); default shows the provider's text as is. */
    display?: DisplayTextPolicy;
    /** Called once the session ended, so the server can forget it. */
    onEnded?: () => void;
    /** Shared state changes for the session registry (S2-04): codec, ended, STT health. */
    onState?: (patch: SessionPatch) => void;
    /** Workspace glossary for the STT provider. */
    keyterms?: readonly string[];
    /** State recorded by an earlier instance (takeover after a crash, §6.2). */
    resume?: { codec: Codec | null; needsBatch: boolean };
  }) {
    this.sessionId = options.sessionId;
    this.#onEnded = options.onEnded;
    this.workspaceId = options.workspaceId;
    this.meetingId = options.meetingId ?? options.sessionId;
    this.#onState = options.onState ?? (() => undefined);
    this.#keyterms = options.keyterms ?? [];
    this.#codec = options.resume?.codec ?? null;
    this.#needsBatch = options.resume?.needsBatch ?? false;
    this.#store = options.store;
    this.#stt = options.stt;
    this.#sink = options.sink ?? new FileSink(options.store);
    this.#assembler = new TranscriptAssembler({
      workspaceId: options.workspaceId,
      meetingId: this.meetingId,
      ...(options.display !== undefined ? { display: options.display } : {}),
    });
    this.#meter = new UsageMeter({
      sessionId: options.sessionId,
      workspaceId: options.workspaceId,
      provider: options.stt?.name ?? null,
      usdPerMinute: options.stt?.usdPerMinute ?? null,
    });
  }

  /** Binds a new connection; the first text frame must be `hello`. */
  /** No client attached; with `lastActivityAt`, lets the server evict abandoned sessions. */
  get connected(): boolean {
    return this.#socket !== null;
  }

  get lastActivityAt(): number {
    return this.#lastActivityAt;
  }

  get ended(): boolean {
    return this.#ended;
  }

  attach(socket: WebSocket): void {
    this.#lastActivityAt = Date.now();
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
        // A client that never comes back must not keep provider sockets (and their keep-alives)
        // open forever; the session itself stays so a late reconnect still resumes (§5.3).
        if (!this.#ended) {
          this.#idleTimer = setTimeout(() => {
            this.#idleTimer = null;
            if (this.#socket === null) void this.#closeStt();
          }, STT_IDLE_CLOSE_MS);
        }
      }
    });
    socket.on('error', (error) => log('stream.socket_error', { code: errorCode(error) }));
  }

  async #hello(socket: WebSocket, text: string): Promise<void> {
    const helloStartMs = Date.now();
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
    if (this.#codec === null) this.#onState({ codec: parsed.format.codec });
    this.#codec = parsed.format.codec;

    if (this.#idleTimer !== null) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    const previous = this.#socket;
    this.#socket = socket;
    if (previous !== null && previous !== socket) previous.close(4000, 'replaced');

    try {
      const lanes = await this.#lanesReady();
      // Writes in flight from the previous connection finish first, so `durableUpTo` is final.
      await Promise.all(LANES.map((l) => this.#writes[l]));
      for (const lane of LANES) {
        lanes[lane].dropPending();
        // The client replays from `durableUpTo`, so the lane can write again.
        this.#writeFailed[lane] = false;
      }
      if (this.#socket !== socket) return;
      this.#meter.connected(this.#codec);
      this.#send(socket, {
        type: 'ready',
        sessionId: this.sessionId,
        acceptedFormat: formatFor(this.#codec),
        durableUpTo: { me: lanes.me.durableUpTo, them: lanes.them.durableUpTo },
      });
      // A reconnecting client learns at once whether live transcription is working.
      if (this.#sttHealth !== 'ok') this.#sendHealth(socket);
      log('stream.ready', {
        sessionId: this.sessionId,
        codec: this.#codec,
        durableMe: lanes.me.durableUpTo,
        durableThem: lanes.them.durableUpTo,
        resumeMe: parsed.resumeFrom.me,
        resumeThem: parsed.resumeFrom.them,
      });
      recordSpan(
        'stream.ready',
        this.meetingId,
        {
          sessionId: this.sessionId,
          resumeMe: parsed.resumeFrom.me,
          resumeThem: parsed.resumeFrom.them,
        },
        helloStartMs,
      );
    } catch (error: unknown) {
      log('stream.resume_failed', { sessionId: this.sessionId, code: errorCode(error) });
      recordSpan(
        'stream.ready',
        this.meetingId,
        { sessionId: this.sessionId },
        helloStartMs,
        Date.now(),
        error,
      );
      this.#fail(socket, 'storage_unavailable', true);
    }
  }

  async #lanesReady(): Promise<Record<Lane, LaneChunker>> {
    if (this.#lanes === null) {
      const durable = await this.#store.durableUpTo(this.workspaceId, this.meetingId);
      this.#lanes ??= { me: new LaneChunker(durable.me), them: new LaneChunker(durable.them) };
    }
    return this.#lanes;
  }

  #binary(socket: WebSocket, bytes: Uint8Array): void {
    this.#lastActivityAt = Date.now();
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
    this.#lastFrameAt[frame.lane] = Date.now();

    if (frame.seq > this.#sttUpTo[frame.lane]) {
      this.#sttUpTo[frame.lane] = frame.seq;
      this.#forwardToStt(
        frame.lane,
        frame.seq,
        frame.payload,
        packets,
        frame.captureMs,
        durationMs,
      );
    }
    this.#writeChunk(frame.lane, false);
  }

  #chunkAudio(chunk: PendingChunk): Uint8Array {
    if (this.#codec === 'opus') {
      return oggOpusFile(
        chunk.payloads.flatMap((p) => unpackOpusFrame(p)),
        { serial: randomInt(0, 2 ** 32), preSkip: preSkipFor(chunk.frames[0]?.seq ?? 0) },
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
    const takenAt = Date.now();
    this.#writes[lane] = this.#writes[lane].then(async () => {
      // After a failed write, a later chunk's ack would cover the lost frames and the client would
      // prune them. Nothing more is written or acked until the client reconnects and replays.
      if (this.#writeFailed[lane]) return;
      try {
        const audio = this.#chunkAudio(chunk);
        await this.#store.put({
          workspaceId: this.workspaceId,
          meetingId: this.meetingId,
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
        this.#writeFailed[lane] = true;
        log('chunk.write_failed', { sessionId: this.sessionId, lane, code: errorCode(error) });
        const socket = this.#socket;
        if (socket !== null) this.#fail(socket, 'storage_failed', true);
        return;
      }
      lanes[lane].committed(lastSeq);
      // Acknowledged only after the durable write (§5.3), so acknowledged = safe.
      const socket = this.#socket;
      if (socket !== null) this.#send(socket, { type: 'ack', lane, upToSeq: lastSeq });
      this.#ackLag.add(Date.now() - takenAt);
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
        this.#event(parsed.event);
        break;
      case 'hello':
        this.#fail(socket, 'duplicate_hello', false);
        break;
    }
  }

  /**
   * Capture events (§6.1 step 6). Video part timing is stored for `video.finalize`; a resend after
   * a reconnect writes the same values again. Participants and active-speaker signals are stored
   * for naming speakers after the call (S3-04).
   */
  #event(event: CaptureEvent): void {
    if (event.sessionId !== this.sessionId) return;
    if (event.type === 'video.part_started') {
      const { partId, mimeType, width, height, fps, at } = event;
      this.#toSink('video', (t) =>
        this.#sink.videoPart(t, { partId, mimeType, width, height, fps, startMs: at }),
      );
    } else if (event.type === 'video.part_stopped') {
      const { partId, fragments, at } = event;
      this.#toSink('video', (t) => this.#sink.videoPart(t, { partId, fragments, stoppedAtMs: at }));
    } else if (event.type === 'participant.joined') {
      const { participantId, displayName, at } = event;
      this.#toSink('speakers', async (t) =>
        this.#sink.speaker?.(t, {
          kind: 'joined',
          externalId: participantId,
          displayName,
          atMs: at,
        }),
      );
    } else if (event.type === 'speaker.active') {
      const { participantId, at } = event;
      this.#toSink('speakers', async (t) =>
        this.#sink.speaker?.(t, { kind: 'active', externalId: participantId, atMs: at }),
      );
    }
  }

  async #end(socket: WebSocket): Promise<void> {
    this.#ended = true;
    this.#onState({ ended: true, endedAt: Date.now() });
    await Promise.all(LANES.map((l) => this.#writeChunk(l, true)));
    if (LANES.some((l) => this.#writeFailed[l])) {
      // The client keeps its unacknowledged frames and retries; ending now would refuse them.
      this.#ended = false;
      this.#onState({ ended: false, endedAt: null });
      if (this.#socket === socket) this.#fail(socket, 'storage_failed', true);
      return;
    }
    await this.#closeStt();
    const usage = await this.#saveUsage();
    this.#toSink('ended', (target) => this.#sink.ended(target, new Date()));
    await this.#sinkWrites;
    log('stream.ended', {
      sessionId: this.sessionId,
      audioMsMe: usage.audioMs.me,
      audioMsThem: usage.audioMs.them,
      sttMsMe: usage.stt.audioMs.me,
      sttMsThem: usage.stt.audioMs.them,
      bytesStored: usage.bytesStored,
      estimatedCostUsd: usage.estimatedCostUsd,
      ...this.latencyFields(),
    });
    if (this.#socket === socket) socket.close(1000, 'ended');
    this.#onEnded?.();
  }

  /** Closes both lanes' provider streams; the next forwarded frame reopens them. */
  async #closeStt(): Promise<void> {
    await Promise.all(
      LANES.map(async (lane) => {
        const stt = this.#laneStt[lane];
        await stt.opening;
        const stream = stt.stream;
        stt.stream = null;
        await stream?.close();
      }),
    );
  }

  /** Gateway shutdown: drop timers and provider sockets. */
  async shutdown(): Promise<void> {
    if (this.#idleTimer !== null) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
    await this.#closeStt();
  }

  async #saveUsage() {
    const usage = this.#meter.snapshot();
    this.#toSink('usage', (target) => this.#sink.usage(target, usage));
    await this.#sinkWrites;
    return usage;
  }

  get #target(): SessionTarget {
    return { workspaceId: this.workspaceId, sessionId: this.sessionId, meetingId: this.meetingId };
  }

  /** Queues a sink write after the earlier ones; failures are logged by kind, never retried here. */
  #toSink(
    kind: 'segments' | 'usage' | 'ended' | 'video' | 'speakers',
    write: (target: SessionTarget) => Promise<void>,
  ): void {
    const target = this.#target;
    this.#sinkWrites = this.#sinkWrites.then(async () => {
      try {
        await write(target);
      } catch (error: unknown) {
        log('sink.write_failed', { sessionId: this.sessionId, kind, code: errorCode(error) });
      }
    });
  }

  #forwardToStt(
    lane: Lane,
    seq: number,
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
      stt.ogg =
        packets === null
          ? null
          : new OggOpusWriter({ serial: randomInt(0, 2 ** 32), preSkip: preSkipFor(seq) });
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
    // Bounded while a provider handshake stalls. The Ogg headers (entry 0) must stay first; audio
    // dropped here is still durable and goes to the batch pass (§6.3).
    if (stt.queued.length > MAX_STT_QUEUE) {
      stt.queued.splice(stt.ogg === null ? 0 : 1, 1);
      this.#markNeedsBatch('stt_queue_overflow');
    }
    if (!opening) return;

    const timeline = stt.timeline;
    const openStartMs = Date.now();
    const sttFields = { sessionId: this.sessionId, lane, provider: provider.name };
    stt.opening = provider
      .open(
        packets === null ? 'pcm16' : 'ogg_opus',
        {
          onResult: (result) => this.#onSttResult(lane, timeline, result),
          onClosed: (reason) => {
            log('stt.closed', { sessionId: this.sessionId, lane, reason });
            // `#closeStt` clears `stream` before closing, so only an unexpected close backs off.
            if (stt.timeline === timeline && stt.stream !== null) {
              stt.stream = null;
              this.#markNeedsBatch('stt_closed');
              this.#setHealth('degraded');
              // Back off before reopening, or a provider that accepts and then closes is reopened
              // on every 100 ms frame (ARCHITECTURE §6.3).
              stt.retryAt = Date.now() + STT_RETRY_MS;
            }
          },
        },
        { diarize: lane === 'them', keyterms: this.#keyterms },
      )
      .then((stream) => {
        stt.stream = stream;
        for (const queued of stt.queued) {
          stream.send(queued.bytes);
          this.#meter.sttSent(lane, queued.durationMs);
        }
        stt.queued = [];
        this.#openFailures = 0;
        this.#setHealth('ok');
        this.#meter.sttStreamOpened();
        log('stt.opened', { sessionId: this.sessionId, lane, provider: provider.name });
        recordSpan('stt.open', this.meetingId, sttFields, openStartMs);
      })
      .catch((error: unknown) => {
        // Audio stays durable; transcription of this gap is left to the batch pass (§6.3).
        log('stt.open_failed', { sessionId: this.sessionId, lane, code: errorCode(error) });
        recordSpan('stt.open', this.meetingId, sttFields, openStartMs, Date.now(), error);
        stt.queued = [];
        stt.retryAt = Date.now() + STT_RETRY_MS;
        this.#openFailures += 1;
        this.#markNeedsBatch('stt_open_failed');
        this.#setHealth(this.#openFailures >= STT_DOWN_AFTER_FAILURES ? 'down' : 'degraded');
      })
      .finally(() => {
        stt.opening = null;
      });
  }

  #onSttResult(lane: Lane, timeline: StreamTimeline, result: SttResult): void {
    const socket = this.#socket;
    if (!result.final) {
      if (socket !== null) {
        const startMs = timeline.toSessionMs(result.startMs);
        const text = this.#assembler.interimText(result.text);
        this.#send(socket, { type: 'transcript.interim', lane, text, startMs });
      }
      return;
    }
    const sentAt = timeline.sentAt(result.endMs);
    if (sentAt !== undefined) this.#sttFinalLatency.add(Date.now() - sentAt);
    const { segments, echoFlags, invalid } = this.#assembler.finalSegments(lane, timeline, result);
    for (const echo of echoFlags) this.#meter.segment(lane, echo);
    if (invalid > 0) log('segment.invalid', { sessionId: this.sessionId, lane, count: invalid });
    if (segments.length === 0) return;
    // Stored whether or not a client is attached (§8.1 step 5); pushed only to a live client.
    this.#toSink('segments', (target) => this.#sink.segments(target, segments));
    if (socket === null) return;
    for (const segment of segments) this.#send(socket, { type: 'transcript.segment', segment });
  }

  /** Upper-bound percentiles (bucket edges) for the session-end log line and its metrics. */
  latencyFields(): Record<string, number> {
    const fields: Record<string, number | undefined> = {
      sttFinalCount: this.#sttFinalLatency.count,
      sttFinalP50Ms: this.#sttFinalLatency.percentile(50),
      sttFinalP95Ms: this.#sttFinalLatency.percentile(95),
      ackLagP50Ms: this.#ackLag.percentile(50),
      ackLagP95Ms: this.#ackLag.percentile(95),
    };
    return Object.fromEntries(
      Object.entries(fields).filter((entry): entry is [string, number] => entry[1] !== undefined),
    );
  }

  get sttHealth(): SttHealth {
    return this.#sttHealth;
  }

  get needsBatch(): boolean {
    return this.#needsBatch;
  }

  /**
   * Outage handling (§6.3): audio keeps being stored; the live transcript has a hole, so the
   * meeting is marked for the batch pass after the call (S3-04 transcribes it in full).
   */
  #markNeedsBatch(reason: string): void {
    if (this.#needsBatch) return;
    this.#needsBatch = true;
    log('session.needs_batch', { sessionId: this.sessionId, reason });
    this.#onState({ needsBatch: true });
  }

  #setHealth(health: SttHealth): void {
    if (this.#sttHealth === health) return;
    this.#sttHealth = health;
    log('stt.health', { sessionId: this.sessionId, health });
    this.#onState({ stt: health });
    const socket = this.#socket;
    if (socket !== null) this.#sendHealth(socket);
  }

  #sendHealth(socket: WebSocket): void {
    const now = Date.now();
    const receiving = (lane: Lane) => ({
      receiving: now - this.#lastFrameAt[lane] < RECEIVING_WINDOW_MS,
    });
    this.#send(socket, {
      type: 'health',
      stt: this.#sttHealth,
      lanes: { me: receiving('me'), them: receiving('them') },
    });
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

/**
 * Only the encoder's first packets carry its lookahead (RFC 7845 §4.2). The extension keeps one
 * encoder per lane for the whole recording, so a chunk or STT stream that starts later must not
 * trim it again (that would drop ~6.5 ms of real audio each time).
 */
function preSkipFor(firstSeq: number): number {
  return firstSeq === 0 ? DEFAULT_PRE_SKIP : 0;
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
