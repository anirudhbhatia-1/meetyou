import { encodeAudioFrame, ServerMessage } from '@meetyou/contracts';
import WebSocket from 'ws';

/**
 * One smoke run (S2-12, IMPLEMENTATION_PLAN): start a session on the API, stream synthetic speech
 * through the gateway exactly as the extension does (hello, binary frames, end), read the stored
 * segments back through the API, then delete the meeting. Only IDs and counts leave this module.
 */
export interface SmokeOptions {
  apiUrl: string;
  accessToken: string;
  /** The gateway checks Origin against the pinned extension (STAGING_SETUP §4). */
  origin: string;
  /** 16 kHz mono PCM16 speech for the `them` lane; `me` gets silence of the same length. */
  pcmThem: Uint8Array;
  /** Pace: 1 = real time. Faster runs keep CI short; STT accepts a modest backlog. */
  speed?: number;
  /** Tests: the gateway URL to dial instead of the API's `streamUrl` (local ws://). */
  streamUrl?: string;
  /** How long to wait for segments after the end (finals arrive after the last audio). */
  segmentTimeoutMs?: number;
  meetingCode?: string;
}

export interface SmokeResult {
  sessionId: string;
  meetingId: string;
  framesSent: number;
  acked: boolean;
  segments: number;
  deleted: boolean;
}

const FRAME_MS = 100;
const FRAME_BYTES = 3200; // 100 ms of 16 kHz mono PCM16

export class SmokeError extends Error {
  /** Which step failed, as a log-safe code (`stream_ready`, `segments_readback`, …). */
  readonly step: string;
  constructor(step: string, detail: string) {
    super(`smoke: ${step} failed (${detail})`);
    this.name = 'SmokeError';
    this.step = step.replace(/ /g, '_');
  }
}

async function api(
  options: SmokeOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return fetch(new URL(path, options.apiUrl), {
    method,
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
}

/** Splits PCM into 100 ms frames; the last one is padded with silence. */
export function pcmFrames(pcm: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  for (let at = 0; at < pcm.byteLength; at += FRAME_BYTES) {
    const frame = new Uint8Array(FRAME_BYTES);
    frame.set(pcm.subarray(at, Math.min(at + FRAME_BYTES, pcm.byteLength)));
    frames.push(frame);
  }
  return frames;
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const start = await api(options, 'POST', '/v1/sessions', {
    platform: 'google_meet',
    meetingCode: options.meetingCode ?? 'smoke-test',
    recordVideo: false,
    clientInfo: { extensionVersion: 'smoke', browser: 'node' },
  });
  if (start.status !== 201) throw new SmokeError('session start', `HTTP ${start.status}`);
  const session = (await start.json()) as {
    sessionId: string;
    meetingId: string;
    streamUrl: string;
    streamToken: string;
  };

  const frames = pcmFrames(options.pcmThem);
  const silence = new Uint8Array(FRAME_BYTES);
  const socket = new WebSocket(
    options.streamUrl ?? session.streamUrl,
    ['minutes.v1', `token.${session.streamToken}`],
    { origin: options.origin },
  );
  let ready = false;
  let maxAck = -1;
  let closed = false;
  socket.on('message', (data) => {
    const parsed = ServerMessage.safeParse(JSON.parse(String(data)));
    if (!parsed.success) return;
    if (parsed.data.type === 'ready') ready = true;
    if (parsed.data.type === 'ack' && parsed.data.lane === 'them') {
      maxAck = Math.max(maxAck, parsed.data.upToSeq);
    }
  });
  socket.on('close', () => {
    closed = true;
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', (error) => reject(new SmokeError('stream connect', error.name)));
  });
  socket.send(
    JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      sessionId: session.sessionId,
      resumeFrom: { me: -1, them: -1 },
      format: { codec: 'pcm16', sampleRate: 16000, channels: 1, frameMs: FRAME_MS },
    }),
  );
  const waitFor = async (done: () => boolean, ms: number, step: string) => {
    const until = Date.now() + ms;
    while (!done()) {
      if (Date.now() > until) throw new SmokeError(step, 'timeout');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  await waitFor(() => ready || closed, 10_000, 'stream ready');
  if (!ready) throw new SmokeError('stream ready', 'closed');

  const pace = FRAME_MS / (options.speed ?? 2);
  for (const [seq, frame] of frames.entries()) {
    const captureMs = seq * FRAME_MS;
    socket.send(encodeAudioFrame({ lane: 'them', seq, captureMs, payload: frame }));
    socket.send(encodeAudioFrame({ lane: 'me', seq, captureMs, payload: silence }));
    await new Promise((r) => setTimeout(r, pace));
  }
  // The gateway acks a lane once its chunk is durable; ending flushes the last chunk, so the
  // final ack arrives before the socket closes. Missing acks mean audio loss.
  socket.send(JSON.stringify({ type: 'control', action: 'end', at: frames.length * FRAME_MS }));
  await waitFor(() => closed, 30_000, 'stream end');
  if (maxAck < frames.length - 1)
    throw new SmokeError('audio ack', `${maxAck + 1}/${frames.length}`);

  // Finals are stored as STT returns them; poll the API until the transcript shows up.
  let segments = 0;
  const until = Date.now() + (options.segmentTimeoutMs ?? 60_000);
  while (segments === 0) {
    const res = await api(options, 'GET', `/v1/meetings/${session.meetingId}/segments`);
    if (res.ok) segments = ((await res.json()) as { items: unknown[] }).items.length;
    if (segments > 0) break;
    if (Date.now() > until) {
      await finish();
      throw new SmokeError('segments readback', 'no segments');
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return finish();

  async function finish(): Promise<SmokeResult> {
    const del = await api(options, 'DELETE', `/v1/meetings/${session.meetingId}`);
    return {
      sessionId: session.sessionId,
      meetingId: session.meetingId,
      framesSent: frames.length,
      acked: maxAck >= frames.length - 1,
      segments,
      deleted: del.status === 204,
    };
  }
}
