import { newUlid } from '@meetyou/contracts';

import { idbDone, VIDEO_STORE } from './idb.ts';

/** ADR-0011 §3.2: MP4/H.264 when supported, else WebM/VP9; both with Opus for the mixed audio. */
export const VIDEO_MIME_TYPES = ['video/mp4;codecs=avc1,opus', 'video/webm;codecs=vp9,opus'];
export const FRAGMENT_MS = 10_000;
export const MIXED_AUDIO_BPS = 48_000;

export type VideoQuality = 'standard' | 'data_saver';

/** ADR-0011 §3.2 bitrate table. */
export const VIDEO_QUALITY: Record<
  VideoQuality,
  { width: number; height: number; frameRate: number; videoBps: number }
> = {
  standard: { width: 1280, height: 720, frameRate: 15, videoBps: 1_000_000 },
  data_saver: { width: 854, height: 480, frameRate: 10, videoBps: 400_000 },
};

/** ADR-0011 §3.2: data saver once the upload backlog exceeds 2 minutes of video (12 fragments). */
export const DATA_SAVER_BACKLOG_FRAGMENTS = (2 * 60_000) / FRAGMENT_MS;

/** Switch to data saver above the backlog limit; back to standard once the backlog has cleared. */
export function nextVideoQuality(current: VideoQuality, backlogFragments: number): VideoQuality {
  if (current === 'standard' && backlogFragments > DATA_SAVER_BACKLOG_FRAGMENTS)
    return 'data_saver';
  if (current === 'data_saver' && backlogFragments === 0) return 'standard';
  return current;
}

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
 * fragments written to IndexedDB first (ADR-0011 §3.2). Pause and resume, and a quality switch,
 * start a new part; `video-uploader.ts` uploads and prunes the fragments.
 */
export function startVideoPart(options: {
  db: IDBDatabase;
  sessionId: string;
  video: MediaStreamTrack;
  mixedAudio: MediaStreamTrack;
  mimeType: string;
  startMs: number;
  quality: VideoQuality;
  /** A fragment is in IndexedDB (wakes the uploader). */
  onFragment(): void;
  onError(context: string, error: unknown): void;
}): VideoPart {
  const partId = `vp_${newUlid()}`;
  const recorder = new MediaRecorder(new MediaStream([options.video, options.mixedAudio]), {
    mimeType: options.mimeType,
    videoBitsPerSecond: VIDEO_QUALITY[options.quality].videoBps,
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
        options.onFragment();
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
