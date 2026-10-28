import { z } from 'zod';
import { Lane, SessionMs } from './common.ts';
import { CaptureEvent } from './events.ts';
import { Segment } from './transcript.ts';

/** Realtime protocol between the capture client and the gateway (ARCHITECTURE §5). */
export const PROTOCOL_VERSION = 1;

export const AudioFormat = z.object({
  codec: z.enum(['pcm16', 'opus']),
  sampleRate: z.literal(16000),
  channels: z.literal(1),
  frameMs: z.literal(100),
});
export type AudioFormat = z.infer<typeof AudioFormat>;

/** Last durable sequence number per lane; -1 means nothing stored yet. */
const LaneSeqs = z.object({
  me: z.number().int().min(-1),
  them: z.number().int().min(-1),
});

// ---------- client → gateway (JSON text frames) ----------

export const ClientHello = z.object({
  type: z.literal('hello'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: z.string().min(1),
  resumeFrom: LaneSeqs,
  format: AudioFormat,
});

export const ClientEvent = z.object({
  type: z.literal('event'),
  seq: z.number().int().nonnegative(),
  event: CaptureEvent,
});

export const ClientControl = z.object({
  type: z.literal('control'),
  action: z.enum(['pause', 'resume', 'end']),
  at: SessionMs,
});

export const ClientPing = z.object({ type: z.literal('ping') });

export const ClientMessage = z.discriminatedUnion('type', [
  ClientHello,
  ClientEvent,
  ClientControl,
  ClientPing,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------- gateway → client (JSON text frames) ----------

export const ServerReady = z.object({
  type: z.literal('ready'),
  sessionId: z.string().min(1),
  acceptedFormat: AudioFormat,
  /** The client replays every frame after these sequence numbers from its local buffer. */
  durableUpTo: LaneSeqs,
});

export const ServerAck = z.object({
  type: z.literal('ack'),
  lane: Lane,
  upToSeq: z.number().int().nonnegative(),
});

export const TranscriptInterim = z.object({
  type: z.literal('transcript.interim'),
  lane: Lane,
  text: z.string(),
  startMs: SessionMs,
});

export const TranscriptSegment = z.object({
  type: z.literal('transcript.segment'),
  segment: Segment,
});

export const SpeakerUpdate = z.object({
  type: z.literal('speaker.update'),
  clusterId: z.string().min(1),
  participantId: z.string().min(1).optional(),
  displayName: z.string().min(1).max(200).optional(),
});

const LaneHealth = z.object({ receiving: z.boolean() });

export const ServerHealth = z.object({
  type: z.literal('health'),
  stt: z.enum(['ok', 'degraded', 'down']),
  lanes: z.object({ me: LaneHealth, them: LaneHealth }),
});

export const ServerError = z.object({
  type: z.literal('error'),
  code: z.string().min(1),
  retryable: z.boolean(),
  message: z.string().optional(),
});

export const ServerPong = z.object({ type: z.literal('pong') });

export const ServerMessage = z.discriminatedUnion('type', [
  ServerReady,
  ServerAck,
  TranscriptInterim,
  TranscriptSegment,
  SpeakerUpdate,
  ServerHealth,
  ServerError,
  ServerPong,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// ---------- binary audio frames (client → gateway) ----------
// Layout (little-endian): lane u8 (0 = me, 1 = them) | seq u32 | captureMs u32 | payload.

export const AUDIO_FRAME_HEADER_BYTES = 9;
const UINT32_MAX = 0xffffffff;

export interface AudioFrame {
  lane: Lane;
  seq: number;
  captureMs: number;
  payload: Uint8Array;
}

export function encodeAudioFrame(frame: AudioFrame): Uint8Array {
  for (const [name, value] of [
    ['seq', frame.seq],
    ['captureMs', frame.captureMs],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
      throw new RangeError(`${name} must be a uint32, got ${value}`);
    }
  }
  const out = new Uint8Array(AUDIO_FRAME_HEADER_BYTES + frame.payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, frame.lane === 'me' ? 0 : 1);
  view.setUint32(1, frame.seq, true);
  view.setUint32(5, frame.captureMs, true);
  out.set(frame.payload, AUDIO_FRAME_HEADER_BYTES);
  return out;
}

export function decodeAudioFrame(bytes: Uint8Array): AudioFrame {
  if (bytes.byteLength < AUDIO_FRAME_HEADER_BYTES) {
    throw new RangeError(`Audio frame too short: ${bytes.byteLength} bytes`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const laneByte = view.getUint8(0);
  if (laneByte !== 0 && laneByte !== 1) {
    throw new RangeError(`Unknown lane byte ${laneByte}`);
  }
  return {
    lane: laneByte === 0 ? 'me' : 'them',
    seq: view.getUint32(1, true),
    captureMs: view.getUint32(5, true),
    payload: bytes.subarray(AUDIO_FRAME_HEADER_BYTES),
  };
}

/** 100 ms of 16 kHz mono PCM16. */
export const PCM16_FRAME_BYTES = 3200;
