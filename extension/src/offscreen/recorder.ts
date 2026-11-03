import { newUlid, type ServerMessage } from '@meetyou/contracts';

import type { Lane, LaneFlags, StreamLink, VideoStatus } from '../messages.ts';
import { startCapture, type CaptureSession } from './capture.ts';
import { createDevSession, devStreamToken } from './dev-gateway.ts';
import { IdbFrameStore } from './frame-store.ts';
import { openMinutesDb } from './idb.ts';
import { StreamClient } from './stream-client.ts';
import { pickVideoMimeType, startVideoPart, type VideoPart } from './video-recorder.ts';

export interface RecorderEvents {
  onTabEnded(): void;
  onMicLost(): void;
  onLevels(me: number | null, them: number): void;
  onLink(link: StreamLink): void;
  onVideo(video: VideoStatus): void;
  onTranscript(message: ServerMessage): void;
  onError(context: string, error: unknown): void;
}

export interface Recorder {
  readonly sessionId: string;
  readonly lanes: LaneFlags;
  readonly micError: string | null;
  readonly link: StreamLink;
  readonly video: VideoStatus;
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

  const capture: CaptureSession = await startCapture({
    streamId: options.streamId,
    video: options.recordVideo,
    workletUrl: options.workletUrl,
    callbacks: {
      onFrame(lane, pcm, captureMs) {
        if (paused || store === null) return;
        const seq = nextSeq[lane]++;
        const payload = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        writes[lane] = writes[lane].then(async () => {
          try {
            await store.put({ lane, seq, captureMs, payload });
            client?.frameWritten(lane, seq);
          } catch (error: unknown) {
            events.onError('audio buffer write failed', error);
          }
        });
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

  return {
    sessionId,
    lanes: capture.lanes,
    micError: capture.micError,
    get link() {
      return link;
    },
    video,
    async pause() {
      if (paused) return;
      paused = true;
      client?.control('pause', capture.nowMs());
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
      await capture.stop();
      await stopPart();
      await Promise.all([writes.me, writes.them]);
      if (client !== null) {
        const { unacked } = await client.stop(at);
        if (unacked > 0) console.warn('offscreen: frames left unacknowledged', unacked);
      }
      db.close();
    },
  };
}
