import { newUlid } from '@meetyou/contracts';

import { idbDone, VIDEO_STORE } from './idb.ts';

/** ADR-0011 §3.2: MP4/H.264 when supported, else WebM/VP9; both with Opus for the mixed audio. */
export const VIDEO_MIME_TYPES = ['video/mp4;codecs=avc1,opus', 'video/webm;codecs=vp9,opus'];
export const FRAGMENT_MS = 10_000;
export const STANDARD_VIDEO_BPS = 1_000_000;
export const MIXED_AUDIO_BPS = 48_000;

export function pickVideoMimeType(isSupported: (type: string) => boolean): string | null {
  return VIDEO_MIME_TYPES.find((type) => isSupported(type)) ?? null;
}

export interface VideoFragmentRow {
  sessionId: string;
  partId: string;
  index: number;
  /** Session-clock start of the part (ARCHITECTURE §5.5); player time t maps to startMs + t. */
  startMs: number;
  mimeType: string;
  createdAt: number;
  blob: Blob;
}

export interface VideoPart {
  readonly partId: string;
  readonly mimeType: string;
  stop(): Promise<{ fragments: number }>;
}

/**
 * Records one video part: the Meet tab video track plus the playback mix of both lanes, in 10 s
 * fragments written to IndexedDB first (ADR-0011 §3.2). Pause and resume start a new part.
 * TODO(S2-14): signed-PUT uploader at lowest priority, data-saver switch, prune after upload.
 */
export function startVideoPart(options: {
  db: IDBDatabase;
  sessionId: string;
  video: MediaStreamTrack;
  mixedAudio: MediaStreamTrack;
  mimeType: string;
  startMs: number;
  onError(context: string, error: unknown): void;
}): VideoPart {
  const partId = `vp_${newUlid()}`;
  const recorder = new MediaRecorder(new MediaStream([options.video, options.mixedAudio]), {
    mimeType: options.mimeType,
    videoBitsPerSecond: STANDARD_VIDEO_BPS,
    audioBitsPerSecond: MIXED_AUDIO_BPS,
  });
  let index = 0;
  let writes: Promise<void> = Promise.resolve();

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    const row: VideoFragmentRow = {
      sessionId: options.sessionId,
      partId,
      index: index++,
      startMs: options.startMs,
      mimeType: options.mimeType,
      createdAt: Date.now(),
      blob: event.data,
    };
    writes = writes.then(async () => {
      try {
        const tx = options.db.transaction(VIDEO_STORE, 'readwrite');
        tx.objectStore(VIDEO_STORE).put(row);
        await idbDone(tx);
      } catch (error: unknown) {
        options.onError('video fragment write failed', error);
      }
    });
  };
  recorder.onerror = (event) => options.onError('MediaRecorder error', event);
  recorder.start(FRAGMENT_MS);

  return {
    partId,
    mimeType: options.mimeType,
    async stop() {
      if (recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          recorder.addEventListener('stop', () => resolve(), { once: true });
          recorder.stop();
        });
      }
      await writes;
      return { fragments: index };
    },
  };
}
