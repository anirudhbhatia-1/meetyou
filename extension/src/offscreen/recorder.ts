import { newUlid, packOpusFrame, type AudioFormat, type ServerMessage } from '@meetyou/contracts';

import type { Lane, LaneFlags, StreamLink, VideoStatus } from '../messages.ts';
import { startCapture, type CaptureSession } from './capture.ts';
import { createDevSession, devStreamToken } from './dev-gateway.ts';
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
  stop(): Promise<void>;
}

/**
 * One recording in the offscreen document: capture → per-lane sequence numbers → IndexedDB
 * (write first) → stream client, plus the video part recorder. Pausing drops frames while the
 * session clock keeps running (ARCHITECTURE §5.5) and closes the video part.
 */
export async function startRecorder(options: {
  streamId: string;
  recordVideo: boolean;
  gatewayUrl: string;
  workletUrl: string;
  preferredCodec: AudioFormat['codec'];
  events: RecorderEvents;
}): Promise<Recorder> {
  const { events } = options;
  const db = await openMinutesDb();

  let sessionId = `local_${newUlid()}`;
  let streamUrl: string | null = null;
  if (options.gatewayUrl !== '') {
    try {
      const session = await createDevSession(options.gatewayUrl);
      sessionId = session.sessionId;
      streamUrl = session.streamUrl;
    } catch (error: unknown) {
      // Recording still captures locally; the panel shows the link as off.
      events.onError('gateway session failed', error);
    }
  }

  const store = streamUrl === null ? null : new IdbFrameStore(db, sessionId);
  const nextSeq: Record<Lane, number> = { me: 0, them: 0 };
  const writes: Record<Lane, Promise<void>> = { me: Promise.resolve(), them: Promise.resolve() };
  let paused = false;
  let client: StreamClient | null = null;
  let link: StreamLink = 'off';

  /** Write first (FR-CAP-07), then tell the stream client; per-lane order is kept by chaining. */
  const enqueueFrame = (lane: Lane, payload: Uint8Array, captureMs: number): void => {
    if (store === null) return;
    const seq = nextSeq[lane]++;
    writes[lane] = writes[lane].then(async () => {
      try {
        await store.put({ lane, seq, captureMs, payload });
        client?.frameWritten(lane, seq);
      } catch (error: unknown) {
        events.onError('audio buffer write failed', error);
      }
    });
  };

  // Opus when streaming and this Chrome can encode it (ADR-0003); PCM16 otherwise.
  const encoders: Partial<Record<Lane, LaneEncoder>> = {};
  if (store !== null && options.preferredCodec === 'opus') {
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

  const capture: CaptureSession = await startCapture({
    streamId: options.streamId,
    video: options.recordVideo,
    workletUrl: options.workletUrl,
    callbacks: {
      onFrame(lane, pcm, captureMs) {
        if (paused || store === null) return;
        const encoder = encoders[lane];
        if (encoder !== undefined) {
          encoder.encode(pcm, captureMs);
        } else {
          enqueueFrame(lane, new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), captureMs);
        }
      },
      onTabEnded: events.onTabEnded,
      onMicLost: events.onMicLost,
      onLevels: events.onLevels,
    },
  });

  if (store !== null && streamUrl !== null && options.gatewayUrl !== '') {
    const baseUrl = options.gatewayUrl;
    client = new StreamClient({
      sessionId,
      streamUrl,
      getToken: () => devStreamToken(baseUrl, sessionId),
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
  let quality: VideoQuality = 'standard';
  let switching: Promise<void> = Promise.resolve();
  const mimeType = pickVideoMimeType((t) => MediaRecorder.isTypeSupported(t));
  const startPart = (): void => {
    if (capture.video === null || mimeType === null) return;
    try {
      part = startVideoPart({
        db,
        sessionId,
        video: capture.video,
        mixedAudio: capture.mixedAudio,
        mimeType,
        startMs: capture.nowMs(),
        quality,
        onFragment: events.onVideoFragment,
        onError: events.onError,
      });
      video = 'recording';
    } catch (error: unknown) {
      events.onError('video recorder failed', error);
      video = 'failed';
    }
  };
  if (options.recordVideo) {
    if (mimeType === null) video = 'unsupported';
    else startPart();
  }

  const stopPart = async (): Promise<void> => {
    const current = part;
    part = null;
    if (current === null) return;
    const { fragments } = await current.stop();
    console.info('offscreen: video part closed', current.partId, fragments);
  };

  /**
   * A bitrate cannot change inside a MediaRecorder run, so a quality switch closes the part and
   * starts a new one. Resolution and frame rate drop through `applyConstraints` on the tab track;
   * [Verify] in S1-13 that Chrome applies them to a tab-capture track (failure keeps 720p).
   */
  const switchQuality = async (next: VideoQuality): Promise<void> => {
    if (part === null || paused || capture.video === null) return;
    await stopPart();
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
    lanes: capture.lanes,
    micError: capture.micError,
    get link() {
      return link;
    },
    video,
    audioClear() {
      if (client === null) return true;
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
      await stopPart();
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
      await stopPart();
      for (const encoder of Object.values(encoders)) {
        try {
          await encoder.flush();
        } catch (error: unknown) {
          events.onError('opus flush failed', error);
        }
        encoder.close();
      }
      await Promise.all([writes.me, writes.them]);
      if (client !== null) {
        const { unacked } = await client.stop(at);
        if (unacked > 0) console.warn('offscreen: frames left unacknowledged', unacked);
      }
      db.close();
    },
  };
}
