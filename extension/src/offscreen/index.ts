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
import { IdbFragmentQueue, VideoUploader } from './video-uploader.ts';

let recorder: Recorder | null = null;
let uploader: Promise<VideoUploader | null> | null = null;
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
        canUpload: () => recorder === null || recorder.audioClear(),
        isUploadable: (sessionId) => sessionId.startsWith('ses_'),
        onProgress: reportUpload,
        onIdle() {
          if (recorder !== null || idleReported) return;
          idleReported = true;
          notifyBackground({ target: 'background', type: 'capture.upload_idle' });
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

function reportUpload(progress: { pending: number; uploaded: number }): void {
  recorder?.setUploadBacklog(progress.pending);
  notifySidePanel({ target: 'sidepanel', type: 'video.upload', ...progress });
}

/** A fragment was written: wake the uploader and re-check the data-saver backlog. */
async function onVideoFragment(): Promise<void> {
  idleReported = false;
  const current = await videoUploader();
  if (current === null) return;
  current.kick();
  reportUpload({ pending: await current.pending(), uploaded: current.uploaded });
}

async function start(streamId: string, recordVideo: boolean): Promise<CaptureStartResult> {
  if (recorder !== null) {
    await recorder.stop();
    recorder = null;
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

/** Stops capture; the reply says whether video is still uploading (the document must stay open). */
async function stop(): Promise<CaptureStopReply> {
  const current = recorder;
  recorder = null;
  await current?.stop();
  const videos = await videoUploader();
  if (videos === null) return { ok: true, uploading: false };
  idleReported = false;
  videos.kick();
  return { ok: true, uploading: (await videos.pending()) > 0 };
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
      const status: CaptureStatusReply = { active: recorder !== null };
      sendResponse(status);
      return false;
    }
  }
});

// Resume fragments left by an earlier recording (e.g. the browser closed mid-upload).
void videoUploader().then((current) => current?.kick());
