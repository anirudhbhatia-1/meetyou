import {
  newUlid,
  packOpusFrame,
  type AudioFormat,
  type CaptureEvent,
  type ServerMessage,
} from '@meetyou/contracts';

import type { Lane, LaneFlags, StreamLink, VideoStatus } from '../messages.ts';
import { startCapture, type CaptureSession } from './capture.ts';
import { IdbFrameStore } from './frame-store.ts';
import { openMinutesDb } from './idb.ts';
import { createLaneEncoder, type LaneEncoder } from './opus-encoder.ts';
import { OPUS_FORMAT, PCM16_FORMAT, StreamClient } from './stream-client.ts';
import {
  nextVideoQuality,
  pickVideoMimeType,
  startVideoPart,
  VIDEO_QUALITY,
  type VideoPart,
  type VideoQuality,
} from './video-recorder.ts';
import { AUDIO_BACKLOG_LIMIT_MS } from './video-uploader.ts';

/** FR-CAP-07: a network loss of up to 10 minutes loses no audio, including one that spans Stop. */
export const DRAIN_TIMEOUT_MS = 10 * 60_000;

export interface RecorderEvents {
  onTabEnded(): void;
  onMicLost(): void;
  onLevels(me: number | null, them: number): void;
  onLink(link: StreamLink): void;
  onVideo(video: VideoStatus): void;
  onTranscript(message: ServerMessage): void;
  /** A video fragment reached IndexedDB. */
  onVideoFragment(): void;
  onError(context: string, error: unknown): void;
}

export interface Recorder {
  readonly sessionId: string;
  readonly lanes: LaneFlags;
  readonly micError: string | null;
  readonly link: StreamLink;
  readonly video: VideoStatus;
  /** True when video may use the link: audio is online with at most 5 s unsent (ADR-0011 §3.3). */
  audioClear(): boolean;
  /** Upload backlog in fragments; drives the data-saver switch (ADR-0011 §3.2). */
  setUploadBacklog(fragments: number): void;
  pause(): Promise<void>;
  resume(): void;
  /**
   * Meet's mute (FR-CAP-11, D-10): while muted, `me` frames are dropped before they are encoded,
   * stored or sent, and the mic leaves the video mix. The `them` lane is never affected.
   */
  setMicMuted(muted: boolean): void;
  /** Opens another microphone as the `me` lane (§9 "Choose microphone"); see `CaptureSession`. */
  attachMic(deviceId: string | null): Promise<string | null>;
  /**
   * Meet says this participant is talking now (S3-04): the gateway gets `participant.joined` the
   * first time (or when the name changes) and `speaker.active` each time, on the session clock.
   */
  noteSpeaker(participantId: string, displayName: string, shownAt: number): void;
  /**
   * Stops capture now. `drained` settles once the buffered audio reached the gateway (or the
   * deadline passed); the offscreen document stays open until then.
   */
  stop(): Promise<{ drained: Promise<void> }>;
}

/**
 * One recording in the offscreen document: capture → per-lane sequence numbers → IndexedDB
 * (write first) → stream client, plus the video part recorder. Pausing drops frames while the
 * session clock keeps running (ARCHITECTURE §5.5) and closes the video part.
 *
 * Capture starts before the gateway session is created: the tab stream ID expires within seconds,
 * so a slow gateway must not sit between the service worker's request and `getUserMedia`. Frames
 * captured meanwhile wait in memory and are written once the session exists.
 */
/**
 * Where a recording's session comes from: the cloud API (started by the service worker) or the
 * local dev gateway. Null `open()` keeps the recording on this computer.
 */
export interface SessionSource {
  open(): Promise<{ sessionId: string; streamUrl: string } | null>;
  /** A stream token for each (re)connect. */
  token(sessionId: string): Promise<string>;
}

export async function startRecorder(options: {
  streamId: string;
  recordVideo: boolean;
  /** Null: no gateway, local-only recording. */
  session: SessionSource | null;
  workletUrl: string;
  preferredCodec: AudioFormat['codec'];
  events: RecorderEvents;
}): Promise<Recorder> {
  const { events } = options;
  const db = await openMinutesDb();

  let sessionId = `local_${newUlid()}`;
  let streamUrl: string | null = null;
  let store: IdbFrameStore | null = null;
  /** True until the gateway session is known; frames wait in `early` meanwhile. */
  let sessionPending = options.session !== null;
  const early: { lane: Lane; payload: Uint8Array; captureMs: number }[] = [];
  const nextSeq: Record<Lane, number> = { me: 0, them: 0 };
  const writes: Record<Lane, Promise<void>> = { me: Promise.resolve(), them: Promise.resolve() };
  let paused = false;
  let micMuted = false;
  let client: StreamClient | null = null;
  let link: StreamLink = 'off';

  /** Write first (FR-CAP-07), then tell the stream client; per-lane order is kept by chaining. */
  const enqueueFrame = (lane: Lane, payload: Uint8Array, captureMs: number): void => {
    if (store === null) {
      if (sessionPending) early.push({ lane, payload, captureMs });
      return;
    }
    const target = store;
    const seq = nextSeq[lane]++;
    writes[lane] = writes[lane].then(async () => {
      try {
        await target.put({ lane, seq, captureMs, payload });
        client?.frameWritten(lane, seq);
      } catch (error: unknown) {
        events.onError('audio buffer write failed', error);
      }
    });
  };

  // Opus when streaming and this Chrome can encode it (ADR-0003); PCM16 otherwise.
  const encoders: Partial<Record<Lane, LaneEncoder>> = {};
  if (sessionPending && options.preferredCodec === 'opus') {
    for (const lane of ['me', 'them'] as const) {
      const encoder = await createLaneEncoder({
        onFrame: (group) => enqueueFrame(lane, packOpusFrame(group.packets), group.captureMs),
        onError: events.onError,
      });
      if (encoder !== null) encoders[lane] = encoder;
    }
    if (encoders.me === undefined || encoders.them === undefined) {
      encoders.me?.close();
      encoders.them?.close();
      delete encoders.me;
      delete encoders.them;
    }
  }
  const format: AudioFormat = encoders.me !== undefined ? OPUS_FORMAT : PCM16_FORMAT;
  console.info('offscreen: audio codec', format.codec);

  const closeEncoders = (): void => {
    for (const encoder of Object.values(encoders)) encoder.close();
    delete encoders.me;
    delete encoders.them;
  };

  let capture: CaptureSession;
  try {
    capture = await startCapture({
      streamId: options.streamId,
      video: options.recordVideo,
      workletUrl: options.workletUrl,
      callbacks: {
        onFrame(lane, pcm, captureMs) {
          if (paused || (store === null && !sessionPending)) return;
          if (lane === 'me' && micMuted) return;
          const encoder = encoders[lane];
          if (encoder !== undefined) {
            encoder.encode(pcm, captureMs);
          } else {
            enqueueFrame(
              lane,
              new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength),
              captureMs,
            );
          }
        },
        onTabEnded: events.onTabEnded,
        onMicLost: events.onMicLost,
        onLevels: events.onLevels,
      },
    });
  } catch (error: unknown) {
    closeEncoders();
    db.close();
    throw error;
  }

  if (options.session !== null) {
    const session = await options.session.open().catch((error: unknown) => {
      events.onError('session open failed', error);
      return null;
    });
    if (session !== null) {
      sessionId = session.sessionId;
      streamUrl = session.streamUrl;
      store = new IdbFrameStore(db, sessionId);
    }
  }
  sessionPending = false;
  if (store === null) {
    // No gateway: the recording stays local-only and the panel shows the link as off.
    early.length = 0;
    closeEncoders();
  } else {
    for (const frame of early.splice(0)) enqueueFrame(frame.lane, frame.payload, frame.captureMs);
  }

  if (store !== null && streamUrl !== null && options.session !== null) {
    const source = options.session;
    client = new StreamClient({
      sessionId,
      streamUrl,
      getToken: () => source.token(sessionId),
      format,
      store,
      openSocket: (url, protocols) => new WebSocket(url, protocols),
      onLink(next) {
        link = next;
        events.onLink(next);
      },
      onServerMessage: events.onTranscript,
      onError: events.onError,
    });
    client.start();
  }

  let video: VideoStatus = 'off';
  let part: VideoPart | null = null;
  /** Video part timing for the gateway (finalize follows the session clock, ADR-0011 §3.4). */
  const emit = (event: CaptureEvent): void => client?.event(event);
  let quality: VideoQuality = 'standard';
  /** Names already sent, by Meet participant ID (per recording; never logged, AGENTS §7). */
  const speakerNames = new Map<string, string>();
  let switching: Promise<void> = Promise.resolve();
  const mimeType = pickVideoMimeType((t) => MediaRecorder.isTypeSupported(t));
  const startPart = (): void => {
    if (capture.video === null || mimeType === null) return;
    try {
      const startMs = capture.nowMs();
      part = startVideoPart({
        db,
        sessionId,
        video: capture.video,
        mixedAudio: capture.mixedAudio,
        mimeType,
        startMs,
        quality,
        onFragment: events.onVideoFragment,
        onError: events.onError,
      });
      video = 'recording';
      emit(partStartedEvent(sessionId, part.partId, mimeType, capture.video, quality, startMs));
    } catch (error: unknown) {
      events.onError('video recorder failed', error);
      video = 'failed';
    }
  };
  if (options.recordVideo) {
    if (mimeType === null) video = 'unsupported';
    else startPart();
  }

  const stopPart = async (
    reason: 'stopped' | 'paused' | 'quality_changed' | 'error',
  ): Promise<void> => {
    const current = part;
    part = null;
    if (current === null) return;
    const { fragments } = await current.stop();
    console.info('offscreen: video part closed', current.partId, fragments);
    emit({
      type: 'video.part_stopped',
      sessionId,
      partId: current.partId,
      fragments,
      reason,
      at: Math.max(0, Math.round(capture.nowMs())),
    });
  };

  /**
   * A bitrate cannot change inside a MediaRecorder run, so a quality switch closes the part and
   * starts a new one. Resolution and frame rate drop through `applyConstraints` on the tab track;
   * [Verify] in S1-13 that Chrome applies them to a tab-capture track (failure keeps 720p).
   */
  const switchQuality = async (next: VideoQuality): Promise<void> => {
    if (part === null || paused || capture.video === null) return;
    await stopPart('quality_changed');
    const { width, height, frameRate } = VIDEO_QUALITY[next];
    try {
      await capture.video.applyConstraints({
        width: { max: width },
        height: { max: height },
        frameRate: { max: frameRate },
      });
    } catch (error: unknown) {
      events.onError('video constraints not applied', error);
    }
    if (!paused) startPart();
    console.info('offscreen: video quality', next);
  };

  return {
    sessionId,
    get lanes() {
      return capture.lanes;
    },
    get micError() {
      return capture.micError;
    },
    attachMic: (deviceId) => capture.attachMic(deviceId),
    get link() {
      return link;
    },
    video,
    audioClear() {
      // `off` with a client means the gateway refused the stream for good; video need not wait.
      if (client === null || link === 'off') return true;
      return link === 'online' && client.backlogMs() <= AUDIO_BACKLOG_LIMIT_MS;
    },
    setUploadBacklog(fragments) {
      const next = nextVideoQuality(quality, fragments);
      if (next === quality) return;
      quality = next;
      switching = switching.then(() => switchQuality(next));
    },
    async pause() {
      if (paused) return;
      paused = true;
      client?.control('pause', capture.nowMs());
      await switching;
      await stopPart('paused');
    },
    noteSpeaker(participantId, displayName, shownAt) {
      // Nothing about the call is kept while the user paused the recording.
      if (paused) return;
      // Messages reach this document a little after Meet showed the change: date it back.
      const delay = Math.min(Math.max(0, Date.now() - shownAt), MAX_SIGNAL_DELAY_MS);
      const at = Math.max(0, Math.round(capture.nowMs() - delay));
      if (speakerNames.get(participantId) !== displayName) {
        speakerNames.set(participantId, displayName);
        emit({ type: 'participant.joined', sessionId, participantId, displayName, at });
      }
      emit({ type: 'speaker.active', sessionId, participantId, at });
    },
    setMicMuted(muted) {
      if (muted === micMuted) return;
      micMuted = muted;
      capture.setMicInMix(!muted);
      emit({ type: 'mic.mute_changed', sessionId, muted, at: capture.nowMs() });
    },
    resume() {
      if (!paused) return;
      paused = false;
      client?.control('resume', capture.nowMs());
      if (video === 'recording') startPart();
      events.onVideo(video);
    },
    async stop() {
      const at = capture.nowMs();
      paused = true;
      await switching;
      await capture.stop();
      await stopPart('stopped');
      for (const encoder of Object.values(encoders)) {
        try {
          await encoder.flush();
        } catch (error: unknown) {
          events.onError('opus flush failed', error);
        }
        encoder.close();
      }
      await Promise.all([writes.me, writes.them]);
      const streaming = client;
      if (streaming === null) {
        db.close();
        return { drained: Promise.resolve() };
      }
      const drained = streaming
        .stop(at, DRAIN_TIMEOUT_MS)
        .then(({ unacked }) => {
          if (unacked > 0) console.warn('offscreen: frames left unacknowledged', unacked);
        })
        .finally(() => db.close());
      return { drained };
    },
  };
}

/** A signal older than this is dated as if it just happened (clock skew, a stuck queue). */
const MAX_SIGNAL_DELAY_MS = 5_000;

/** `video.part_started` within the contract's bounds (dimensions as the track reports them). */
function partStartedEvent(
  sessionId: string,
  partId: string,
  mimeType: string,
  track: MediaStreamTrack,
  quality: VideoQuality,
  startMs: number,
): CaptureEvent {
  const settings = track.getSettings();
  const fallback = VIDEO_QUALITY[quality];
  const clamp = (value: number | undefined, max: number, otherwise: number) =>
    Math.min(max, Math.max(1, Math.round(value ?? otherwise)));
  return {
    type: 'video.part_started',
    sessionId,
    partId,
    source: 'tab',
    mimeType: mimeType.startsWith('video/webm') ? 'video/webm' : 'video/mp4',
    width: clamp(settings.width, 1920, fallback.width),
    height: clamp(settings.height, 1080, fallback.height),
    fps: clamp(settings.frameRate, 30, fallback.frameRate),
    at: Math.max(0, Math.round(startMs)),
  };
}
