import type { ServerMessage } from '@meetyou/contracts';

import { AUDIO_CODEC, GATEWAY_URL } from '../build-config.ts';
import {
  parseOffscreenMessage,
  type BackgroundMessage,
  type CaptureStartResult,
  type CaptureStatusReply,
  type CaptureStopReply,
  type SidePanelMessage,
} from '../messages.ts';
import { CaptureStartError } from './capture.ts';
import { putFragment, signDevVideoFragments } from './dev-gateway.ts';
import { openMinutesDb } from './idb.ts';
import { startRecorder, type Recorder } from './recorder.ts';
import {
  IdbFragmentQueue,
  pruneStaleFragments,
  VideoUploader,
  VIDEO_RETENTION_MS,
} from './video-uploader.ts';

let recorder: Recorder | null = null;
let uploader: Promise<VideoUploader | null> | null = null;
/** Stopped recordings still sending buffered audio (FR-CAP-07); the document stays open for them. */
const drains = new Set<Promise<void>>();
/** Stopped recorders whose audio is still draining: video must wait for them too (audio first). */
const draining = new Set<Recorder>();
/** Stops in progress; until they register their drain, the document is not idle. */
let stopping = 0;
let videoIdle = true;
let idleReported = false;

/** Logs carry IDs, counts and error names only (AGENTS §7), never transcript text. */
function logError(context: string, error: unknown): void {
  const detail =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'number' || typeof error === 'boolean'
        ? String(error)
        : '';
  console.error(`offscreen: ${context}`, detail);
}

function notifyBackground(message: BackgroundMessage): void {
  chrome.runtime.sendMessage(message).catch((error: unknown) => {
    logError(`notify background ${message.type}`, error);
  });
}

// Best effort: the side panel is a UI aid, and nothing listens while it is closed.
function notifySidePanel(message: SidePanelMessage): void {
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

function forwardTranscript(message: ServerMessage): void {
  if (message.type === 'transcript.interim') {
    notifySidePanel({
      target: 'sidepanel',
      type: 'transcript',
      final: false,
      lane: message.lane,
      text: message.text,
      startMs: message.startMs,
      speaker: null,
    });
  } else if (message.type === 'transcript.segment') {
    notifySidePanel({
      target: 'sidepanel',
      type: 'transcript',
      final: true,
      lane: message.segment.lane,
      text: message.segment.text,
      startMs: message.segment.startMs,
      speaker: message.segment.speakerClusterId ?? null,
    });
  }
}

/**
 * One uploader for the document's lifetime: it outlives each recording, so video keeps uploading
 * after the meeting ends and leftovers of earlier recordings resume (ADR-0011 §3.3). Only gateway
 * sessions (`ses_…`) upload; `local_…` recordings were made without one.
 */
function videoUploader(): Promise<VideoUploader | null> {
  if (GATEWAY_URL === '') return Promise.resolve(null);
  uploader ??= openMinutesDb().then(
    (db) =>
      new VideoUploader({
        queue: new IdbFragmentQueue(db),
        sign: (sessionId, partId, indices, contentType) =>
          signDevVideoFragments(GATEWAY_URL, sessionId, partId, indices, contentType),
        put: putFragment,
        canUpload: () =>
          (recorder === null || recorder.audioClear()) &&
          [...draining].every((r) => r.audioClear()),
        isUploadable: (sessionId) => sessionId.startsWith('ses_'),
        onProgress: reportUpload,
        onIdle() {
          videoIdle = true;
          reportIdleIfDone();
        },
        onError: logError,
      }),
    (error: unknown) => {
      logError('video uploader unavailable', error);
      return null;
    },
  );
  return uploader;
}

/** Tells the service worker it may close the document: no recording, audio drain or video left. */
function isBusy(): boolean {
  return recorder !== null || stopping > 0 || drains.size > 0 || !videoIdle;
}

function reportIdleIfDone(): void {
  if (isBusy() || idleReported) return;
  idleReported = true;
  notifyBackground({ target: 'background', type: 'capture.upload_idle' });
}

/** Stops a recording and keeps its audio drain alive until the buffered frames are acknowledged. */
async function stopRecorder(current: Recorder): Promise<void> {
  // Counted before the first await: until the drain is registered, an uploader going idle must
  // not let the service worker close the document (it would kill the drain).
  stopping += 1;
  try {
    const { drained } = await current.stop();
    drains.add(drained);
    draining.add(current);
    void drained.finally(() => {
      drains.delete(drained);
      draining.delete(current);
      reportIdleIfDone();
    });
  } finally {
    stopping -= 1;
  }
}

function reportUpload(progress: { pending: number; uploaded: number }): void {
  recorder?.setUploadBacklog(progress.pending);
  notifySidePanel({ target: 'sidepanel', type: 'video.upload', ...progress });
}

/** A fragment was written: wake the uploader and re-check the data-saver backlog. */
async function onVideoFragment(): Promise<void> {
  idleReported = false;
  videoIdle = false;
  const current = await videoUploader();
  if (current === null) return;
  current.kick();
  reportUpload({ pending: await current.pending(), uploaded: current.uploaded });
}

async function start(streamId: string, recordVideo: boolean): Promise<CaptureStartResult> {
  if (recorder !== null) {
    const previous = recorder;
    recorder = null;
    await stopRecorder(previous);
  }
  try {
    recorder = await startRecorder({
      streamId,
      recordVideo,
      gatewayUrl: GATEWAY_URL,
      preferredCodec: AUDIO_CODEC,
      workletUrl: chrome.runtime.getURL('offscreen/pcm-worklet.js'),
      events: {
        onTabEnded: () => notifyBackground({ target: 'background', type: 'capture.tab_ended' }),
        onMicLost: () => notifyBackground({ target: 'background', type: 'capture.mic_lost' }),
        onLevels: (me, them) =>
          notifySidePanel({ target: 'sidepanel', type: 'capture.levels', me, them }),
        onLink: (link) => notifyBackground({ target: 'background', type: 'capture.link', link }),
        onVideo: (video) =>
          notifyBackground({ target: 'background', type: 'capture.video', video }),
        onTranscript: forwardTranscript,
        onVideoFragment: () => {
          onVideoFragment().catch((error: unknown) => logError('video upload wake failed', error));
        },
        onError: logError,
      },
    });
    (await videoUploader())?.kick();
    return {
      ok: true,
      sessionId: recorder.sessionId,
      lanes: recorder.lanes,
      micError: recorder.micError,
      link: recorder.link,
      video: recorder.video,
    };
  } catch (error: unknown) {
    const reason = error instanceof CaptureStartError ? error.reason : 'audio_context_failed';
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    logError(`capture start failed (${reason})`, cause);
    return { ok: false, reason };
  }
}

/**
 * Stops capture. The reply says whether buffered audio or video is still going to the gateway, in
 * which case the document must stay open until `capture.upload_idle`.
 */
async function stop(): Promise<CaptureStopReply> {
  const current = recorder;
  recorder = null;
  idleReported = false;
  if (current !== null) await stopRecorder(current);
  const videos = await videoUploader();
  let videoPending = 0;
  if (videos !== null) {
    videoIdle = false;
    videos.kick();
    videoPending = await videos.pending();
  }
  return { ok: true, uploading: drains.size > 0 || videoPending > 0 };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const parsed = parseOffscreenMessage(message);
  if (parsed === null) return false;

  const reply = (task: Promise<unknown>): true => {
    task.then(sendResponse, (error: unknown) => {
      logError(`${parsed.type} failed`, error);
      sendResponse({ ok: false });
    });
    // Keeps the message channel open for the async reply.
    return true;
  };

  switch (parsed.type) {
    case 'capture.start':
      return reply(start(parsed.streamId, parsed.recordVideo));
    case 'capture.stop':
      return reply(stop());
    case 'capture.pause':
      return reply((recorder?.pause() ?? Promise.resolve()).then(() => ({ ok: true })));
    case 'capture.resume':
      recorder?.resume();
      sendResponse({ ok: true });
      return false;
    case 'capture.status': {
      const status: CaptureStatusReply = { active: recorder !== null, busy: isBusy() };
      sendResponse(status);
      return false;
    }
  }
});

// Resume fragments left by an earlier recording (e.g. the browser closed mid-upload). This runs
// when the document opens, i.e. at the next recording start.
// TODO(S2-14): resume after a browser restart without waiting for a recording (ADR-0011 §3.3).
void videoUploader().then((current) => current?.kick());

// Video that never uploads (no gateway, or a session the gateway lost) is kept no longer than
// recordings are retained by default (D-02), so `video_buffer` cannot grow without bound.
void openMinutesDb()
  .then((db) => pruneStaleFragments(db, Date.now() - VIDEO_RETENTION_MS).finally(() => db.close()))
  .then((pruned) => {
    if (pruned > 0) console.info('offscreen: stale video fragments deleted', pruned);
  })
  .catch((error: unknown) => logError('video prune failed', error));
