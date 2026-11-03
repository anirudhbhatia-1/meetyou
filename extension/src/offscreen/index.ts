import type { ServerMessage } from '@meetyou/contracts';

import { GATEWAY_URL } from '../build-config.ts';
import {
  parseOffscreenMessage,
  type BackgroundMessage,
  type CaptureStartResult,
  type CaptureStatusReply,
  type SidePanelMessage,
} from '../messages.ts';
import { CaptureStartError } from './capture.ts';
import { startRecorder, type Recorder } from './recorder.ts';

let recorder: Recorder | null = null;

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
    });
  } else if (message.type === 'transcript.segment') {
    notifySidePanel({
      target: 'sidepanel',
      type: 'transcript',
      final: true,
      lane: message.segment.lane,
      text: message.segment.text,
      startMs: message.segment.startMs,
    });
  }
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
        onError: logError,
      },
    });
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

async function stop(): Promise<void> {
  const current = recorder;
  recorder = null;
  await current?.stop();
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
      return reply(stop().then(() => ({ ok: true })));
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
