import {
  parseBackgroundMessage,
  parseMeetCallState,
  parseMeetStateReply,
  senderTabId,
  type MeetCallState,
  parseCaptureStartResult,
  parseCaptureStatusReply,
  parseCaptureStopReply,
  type AccessTokenReply,
  type AuthReply,
  type OffscreenMessage,
  type StartedSession,
} from '../messages.ts';
import {
  badgeFor,
  canStart,
  canStop,
  CAPTURE_STATE_KEY,
  CAPTURING,
  hasLeftCall,
  nextCaptureState,
  parseCaptureState,
  type CaptureEvent,
  type CaptureState,
} from './capture-state.ts';
import { isMeetUrl, meetingCodeOf } from './meet-tab.ts';
import { LAST_RECORDING_KEY, type LastRecording } from '../last-recording.ts';
import { RECORD_VIDEO_KEY, recordVideoFrom } from '../settings.ts';
import { startApiSession } from '../api-client.ts';
import { API_URL, GOOGLE_CLIENT_ID } from '../build-config.ts';
import { ExtensionAuth } from './auth.ts';

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/index.html';
/**
 * After the tab leaves the call, its state is re-read after these delays and must still be out of
 * the call every time before recording stops: a confirmed `ended` stops sooner, an unclear state
 * (usually `lobby` on the left-meeting screen) needs longer so a re-render cannot end a meeting.
 */
const ENDED_CONFIRM_MS = [3000];
const LEFT_CONFIRM_MS = [5000, 10_000];
let creatingOffscreenDocument: Promise<void> | undefined;

/** Chrome extension errors carry no meeting content, so the message is safe to log. */
function logError(context: string, error: unknown): void {
  console.error(context, error instanceof Error ? `${error.name}: ${error.message}` : error);
}

async function configureSidePanel(tabId: number, url: string | undefined): Promise<void> {
  if (!isMeetUrl(url)) {
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
    return;
  }

  await chrome.sidePanel.setOptions({
    tabId,
    enabled: true,
    path: 'sidepanel/index.html',
  });
}

async function configureExistingTabs(): Promise<void> {
  await chrome.sidePanel.setOptions({ enabled: false });

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.flatMap((tab) => (tab.id === undefined ? [] : [configureSidePanel(tab.id, tab.url)])),
  );
}

function offscreenUrl(): string {
  return chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
}

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl()],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (creatingOffscreenDocument !== undefined) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'Capture Google Meet media after an explicit recording action.',
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = undefined;
  }
}

async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

function sendToOffscreen(message: OffscreenMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

async function loadCaptureState(): Promise<CaptureState> {
  const items = await chrome.storage.session.get(CAPTURE_STATE_KEY);
  return parseCaptureState(items[CAPTURE_STATE_KEY]);
}

/**
 * Persists the next state; `chrome.storage.onChanged` is the broadcast to extension pages. The
 * badge and the recorded tab's content script are updated here too (ARCHITECTURE §4.2).
 */
async function applyCaptureEvent(event: CaptureEvent): Promise<CaptureState> {
  const previous = await loadCaptureState();
  const next = nextCaptureState(previous, event);
  if (next === previous) return next;
  await chrome.storage.session.set({ [CAPTURE_STATE_KEY]: next });

  const badge = badgeFor(next);
  await Promise.all([
    chrome.action.setBadgeText({ text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ color: badge.color }),
  ]).catch((error: unknown) => logError('badge update failed', error));

  const tabId = next.tabId ?? previous.tabId;
  if (tabId !== null) {
    // Best effort: the Meet content script (S1-07/S1-09) may not be listening yet.
    chrome.tabs.sendMessage(tabId, contentStateMessage(next)).catch(() => undefined);
  }
  return next;
}

/** What the Meet tab's prompt chip and recording pill need (DESIGN §8.2, §8.4). */
function contentStateMessage(state: CaptureState): Record<string, unknown> {
  return {
    target: 'content',
    type: 'recording.state',
    status: state.status,
    startedAt: state.startedAt,
    video: state.video,
  };
}

function notifyPromptProblem(tabId: number, problem: 'start_failed' | 'panel_failed'): void {
  chrome.tabs
    .sendMessage(tabId, { target: 'content', type: 'prompt.problem', problem })
    .catch(() => undefined);
}

// Capture tasks run one at a time so a double click or a shortcut during start cannot interleave.
let captureQueue: Promise<void> = Promise.resolve();

function enqueueCapture(task: () => Promise<void>): void {
  captureQueue = captureQueue.then(task).catch((error: unknown) => {
    logError('capture task failed', error);
  });
}

async function failCapture(event: Extract<CaptureEvent, { type: 'failed' }>): Promise<void> {
  await closeOffscreenDocument().catch((error: unknown) => {
    logError('close offscreen after failure', error);
  });
  await applyCaptureEvent(event);
}

async function recordVideoSetting(): Promise<boolean> {
  return recordVideoFrom(await chrome.storage.local.get(RECORD_VIDEO_KEY));
}

/** Cloud mode only (S2-09): the build names an API. */
const auth =
  API_URL === '' ? null : new ExtensionAuth({ apiUrl: API_URL, googleClientId: GOOGLE_CLIENT_ID });

/**
 * Cloud mode: start the session on the API before capture (the meeting row and stream token come
 * from there). Undefined in dev builds; a failure is the recording's error.
 */
async function startCloudSession(
  meetingCode: string | null,
  recordVideo: boolean,
): Promise<StartedSession | undefined | 'signed_out' | 'server_unreachable'> {
  if (auth === null) return undefined;
  let token: string | null;
  try {
    token = await auth.accessToken();
  } catch (error: unknown) {
    logError('access token refresh failed', error);
    return 'server_unreachable';
  }
  if (token === null) return 'signed_out';
  try {
    const started = await startApiSession(API_URL, token, {
      // Meet codes look like abc-defg-hij; an unknown one still records.
      meetingCode: meetingCode ?? 'unknown',
      recordVideo,
      extensionVersion: chrome.runtime.getManifest().version,
    });
    return {
      sessionId: started.sessionId,
      meetingId: started.meetingId,
      streamUrl: started.streamUrl,
      streamToken: started.streamToken,
    };
  } catch (error: unknown) {
    logError('API session start failed', error);
    return 'server_unreachable';
  }
}

async function startRecording(tabId: number | undefined): Promise<void> {
  const state = await loadCaptureState();
  if (!canStart(state)) {
    return;
  }
  if (tabId === undefined) {
    await applyCaptureEvent({ type: 'failed', error: 'no_active_tab' });
    return;
  }
  const tab = await chrome.tabs.get(tabId);
  if (!isMeetUrl(tab.url)) {
    await applyCaptureEvent({ type: 'failed', error: 'not_meet_tab' });
    return;
  }

  const meetingCode = meetingCodeOf(tab.url);
  await applyCaptureEvent({
    type: 'start_requested',
    tabId,
    meetingCode,
    at: Date.now(),
  });
  const recordVideo = await recordVideoSetting();
  const session = await startCloudSession(meetingCode, recordVideo);
  if (session === 'signed_out' || session === 'server_unreachable') {
    await applyCaptureEvent({ type: 'failed', error: session });
    return;
  }

  try {
    await ensureOffscreenDocument();
  } catch (error: unknown) {
    logError('offscreen create failed', error);
    await failCapture({ type: 'failed', error: 'offscreen_failed' });
    return;
  }

  // Asked for last because the ID expires a few seconds after it is issued. Chrome allows it only
  // after the user invoked the extension on this tab (action click or shortcut).
  let streamId: string;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (error: unknown) {
    logError('tabCapture.getMediaStreamId failed', error);
    await failCapture({ type: 'failed', error: 'capture_not_allowed' });
    return;
  }

  let reply: unknown;
  try {
    reply = await sendToOffscreen({
      target: 'offscreen',
      type: 'capture.start',
      streamId,
      recordVideo,
      ...(session !== undefined ? { session } : {}),
    });
  } catch (error: unknown) {
    logError('offscreen capture.start failed', error);
  }
  const result = parseCaptureStartResult(reply);
  if (result === null || !result.ok) {
    await failCapture({ type: 'failed', error: result?.reason ?? 'offscreen_failed' });
    return;
  }
  const started = await applyCaptureEvent({
    type: 'started',
    sessionId: result.sessionId,
    lanes: result.lanes,
    micError: result.micError,
    link: result.link,
    video: result.video,
  });
  if (started.startedAt !== null) {
    const last: LastRecording = {
      sessionId: result.sessionId,
      startedAt: started.startedAt,
      ...(session !== undefined ? { meetingId: session.meetingId } : {}),
    };
    await chrome.storage.local
      .set({ [LAST_RECORDING_KEY]: last })
      .catch((error: unknown) => logError('save last recording failed', error));
  }
  // Usually recording starts inside the call; the adapter only reports state changes, so ask.
  if ((await readCallState(tabId)) === 'in_call') await applyCaptureEvent({ type: 'call_joined' });
}

async function stopRecording(): Promise<void> {
  const state = await loadCaptureState();
  if (!canStop(state)) {
    return;
  }
  await applyCaptureEvent({ type: 'stop_requested' });
  let uploading = false;
  try {
    const reply = await sendToOffscreen({ target: 'offscreen', type: 'capture.stop' });
    uploading = parseCaptureStopReply(reply)?.uploading === true;
  } catch (error: unknown) {
    // Closing the document below still releases the streams.
    logError('offscreen stop failed', error);
  }
  // Video keeps uploading after the meeting (ADR-0011 §3.3); `capture.upload_idle` closes it later.
  if (!uploading) await closeOffscreenQuietly();
  await applyCaptureEvent({ type: 'stopped' });
}

async function closeOffscreenQuietly(): Promise<void> {
  try {
    await closeOffscreenDocument();
  } catch (error: unknown) {
    logError('close offscreen failed', error);
  }
}

/** The offscreen document finished uploading video; close it unless a recording uses it. */
async function closeIfUploadsDone(): Promise<void> {
  if (!canStart(await loadCaptureState())) return;
  // Backstop: ask the document itself, which knows about drains and stops in flight.
  try {
    const reply = parseCaptureStatusReply(
      await sendToOffscreen({ target: 'offscreen', type: 'capture.status' }),
    );
    if (reply?.busy === true) return;
  } catch (error: unknown) {
    logError('offscreen status failed', error);
  }
  await closeOffscreenQuietly();
}

async function pauseRecording(): Promise<void> {
  const state = await loadCaptureState();
  if (state.status !== 'recording' && state.status !== 'reconnecting') {
    return;
  }
  await sendToOffscreen({ target: 'offscreen', type: 'capture.pause' });
  await applyCaptureEvent({ type: 'paused' });
}

async function resumeRecording(): Promise<void> {
  const state = await loadCaptureState();
  if (state.status !== 'paused') {
    return;
  }
  await sendToOffscreen({ target: 'offscreen', type: 'capture.resume' });
  await applyCaptureEvent({ type: 'resumed' });
}

/**
 * A restarted service worker trusts the stored state only if the offscreen document still holds a
 * recording (ARCHITECTURE §4.1: the worker keeps no critical state in memory).
 */
async function reconcileAfterRestart(): Promise<void> {
  const state = await loadCaptureState();
  if (!CAPTURING.has(state.status)) {
    return;
  }
  let active = false;
  if (await hasOffscreenDocument()) {
    try {
      active =
        parseCaptureStatusReply(
          await sendToOffscreen({ target: 'offscreen', type: 'capture.status' }),
        )?.active === true;
    } catch (error: unknown) {
      logError('offscreen status failed', error);
    }
  }
  if (!active) {
    await failCapture({ type: 'failed', error: 'capture_lost' });
  }
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

async function stopIfCapturing(tabId: number): Promise<void> {
  const state = await loadCaptureState();
  if (state.tabId === tabId) {
    await stopRecording();
  }
}

async function readCallState(tabId: number): Promise<MeetCallState | null> {
  try {
    return parseMeetStateReply(await chrome.tabs.sendMessage(tabId, { type: 'meet.get-state' }));
  } catch (error: unknown) {
    // No content script answered; the tab URL and tab-close checks still apply.
    logError('meet.get-state failed', error);
    return null;
  }
}

/** Marks the recording as in the call when the recorded tab reports `in_call`. */
async function noteCallJoined(tabId: number): Promise<void> {
  const state = await loadCaptureState();
  if (state.tabId !== tabId || state.callJoined || !CAPTURING.has(state.status)) return;
  await applyCaptureEvent({ type: 'call_joined' });
  console.info('call: joined (recorded tab in call)');
}

/**
 * Stopping loses the rest of a meeting if the adapter is wrong, so the left-call state is re-read
 * from the tab and must still hold at every check (selectors can flicker while Meet re-renders).
 */
async function stopIfCallLeft(tabId: number, reported: MeetCallState): Promise<void> {
  const state = await loadCaptureState();
  if (state.tabId !== tabId || !canStop(state)) return;
  // States and decisions only, no meeting content (AGENTS §7); read in the worker's console.
  if (!hasLeftCall(state, reported)) {
    console.info(`call: ${reported} ignored (not joined since recording started)`);
    return;
  }
  // The check outlives its recording if that one stops meanwhile; it must not stop the next one.
  const startedAt = state.startedAt;
  const delays = reported === 'ended' ? ENDED_CONFIRM_MS : LEFT_CONFIRM_MS;
  console.info(`call: ${reported}; confirming at ${delays.join('/')} ms before stopping`);
  let waited = 0;
  for (const at of delays) {
    await new Promise((resolve) => setTimeout(resolve, at - waited));
    waited = at;
    const now = await readCallState(tabId);
    if (now === null || now === 'in_call') {
      console.info(`call: still ${now ?? 'unknown'} at ${at} ms; keep recording`);
      return;
    }
  }
  console.info('call: left; stopping recording');
  enqueueCapture(async () => {
    if ((await loadCaptureState()).startedAt === startedAt) await stopIfCapturing(tabId);
  });
}

/**
 * Meet keeps the call URL on its "You left the meeting" screen, so the URL alone cannot tell that a
 * call ended; the adapter's `ended` state does (S1-07). The URL still catches leaving to Meet home
 * or another meeting in the same tab.
 */
async function stopIfMeetingChanged(tabId: number, url: string): Promise<void> {
  const state = await loadCaptureState();
  if (state.tabId === tabId && meetingCodeOf(url) !== state.meetingCode) {
    await stopRecording();
  }
}

/**
 * The action click opens the panel itself instead of `openPanelOnActionClick`: a browser-opened
 * panel does not count as invoking the extension, so `tabCapture.getMediaStreamId` was refused
 * (seen in Chrome 2026-11-03). A real `action.onClicked` grants capture for that tab until it
 * navigates. The flag is persisted per profile, so it is reset explicitly.
 */
function disableBrowserOpenedPanel(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error: unknown) => logError('setPanelBehavior failed', error));
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined || !isMeetUrl(tab.url)) {
    return;
  }
  // Called synchronously so it runs inside the click's user gesture.
  chrome.sidePanel
    .open({ tabId: tab.id })
    .catch((error: unknown) => logError('open side panel failed', error));
});

chrome.runtime.onInstalled.addListener((details) => {
  disableBrowserOpenedPanel();
  configureExistingTabs().catch((error: unknown) => logError('configure tabs failed', error));

  if (details.reason === 'install') {
    chrome.tabs
      .create({ url: 'onboarding/index.html' })
      .catch((error: unknown) => logError('open onboarding failed', error));
  }
});

chrome.runtime.onStartup.addListener(() => {
  disableBrowserOpenedPanel();
  configureExistingTabs().catch((error: unknown) => logError('configure tabs failed', error));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? tab.url;
  configureSidePanel(tabId, url).catch((error: unknown) =>
    logError('configure side panel failed', error),
  );
  // Leaving the meeting's URL in the recorded tab ends the recording.
  const changedUrl = changeInfo.url;
  if (changedUrl !== undefined) {
    enqueueCapture(() => stopIfMeetingChanged(tabId, changedUrl));
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs
    .get(activeInfo.tabId)
    .then((tab) => configureSidePanel(activeInfo.tabId, tab.url))
    .catch((error: unknown) => logError('configure side panel failed', error));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueueCapture(() => stopIfCapturing(tabId));
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-recording') {
    enqueueCapture(async () => {
      const state = await loadCaptureState();
      if (canStart(state)) {
        await startRecording(tab?.id);
      } else {
        await stopRecording();
      }
    });
  } else if (command === 'toggle-pause') {
    enqueueCapture(async () => {
      const state = await loadCaptureState();
      if (state.status === 'paused') {
        await resumeRecording();
      } else {
        await pauseRecording();
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const callState = parseMeetCallState(message);
  const fromTab = senderTabId(sender);
  if (callState !== null && fromTab !== null) {
    if (callState === 'in_call') {
      enqueueCapture(() => noteCallJoined(fromTab));
    } else {
      stopIfCallLeft(fromTab, callState).catch((error: unknown) =>
        logError('left-call check failed', error),
      );
    }
    return false;
  }

  if (typeof message === 'object' && message !== null) {
    const record = message as Record<string, unknown>;
    if (record.type === 'meet.page-ready') {
      // The content script asks once so its prompt chip never shows over a running recording.
      void loadCaptureState().then((state) => {
        // Another tab's recording shows nothing here: its pill belongs to the recorded tab.
        sendResponse(
          fromTab !== null && state.tabId === fromTab
            ? contentStateMessage(state)
            : { status: 'idle', startedAt: null, video: 'off' },
        );
      });
      return true;
    }
    // TODO(FR-CAP-11, S2-04): forward mute and speaker events of the recording tab to the
    // offscreen document for me-lane gating and speaker naming; today they are only observed.
    if (record.type === 'meet.mute-changed') {
      console.log(`[MeetYou] Background observed mic.mute_changed: muted=${Boolean(record.muted)}`);
      return false;
    }
    if (record.type === 'meet.speaker-active' && typeof record.participantId === 'string') {
      // AGENTS §7: no names or participant IDs in logs.
      console.log('[MeetYou] Background observed speaker.active');
      return false;
    }
  }

  const parsed = parseBackgroundMessage(message);
  if (parsed === null) {
    return false;
  }

  if (parsed.type === 'auth.token') {
    const reply = (token: string | null): void =>
      sendResponse({ token } satisfies AccessTokenReply);
    if (auth === null) {
      reply(null);
      return false;
    }
    auth.accessToken().then(reply, (error: unknown) => {
      logError('access token for offscreen failed', error);
      reply(null);
    });
    return true;
  }
  if (parsed.type === 'auth.sign_in' || parsed.type === 'auth.sign_out') {
    const reply = (ok: boolean): void => sendResponse({ ok } satisfies AuthReply);
    if (auth === null) {
      reply(false);
      return false;
    }
    const task = parsed.type === 'auth.sign_in' ? auth.signIn() : auth.signOut();
    task.then(
      () => reply(true),
      (error: unknown) => {
        logError(`${parsed.type} failed`, error);
        reply(false);
      },
    );
    return true;
  }

  switch (parsed.type) {
    case 'recording.start':
      enqueueCapture(async () => startRecording(await activeTabId()));
      break;
    case 'prompt.open-sidepanel': {
      const tabId = fromTab;
      if (tabId !== null) {
        chrome.sidePanel
          .open({ tabId })
          .then(() => {
            console.log('[MeetYou] Prompt chip: chrome.sidePanel.open() SUCCEEDED for tab', tabId);
          })
          .catch((error: unknown) => {
            logError('[MeetYou] Prompt chip: chrome.sidePanel.open() FAILED', error);
            notifyPromptProblem(tabId, 'panel_failed');
          });
      }
      break;
    }
    case 'pill.open-sidepanel':
      // From a trusted click on the recording pill; a refusal leaves the toolbar icon as the way in.
      if (fromTab !== null) {
        chrome.sidePanel.open({ tabId: fromTab }).catch((error: unknown) => {
          logError('pill: sidePanel.open failed', error);
        });
      }
      break;
    case 'prompt.start-recording': {
      enqueueCapture(async () => {
        const tabId = fromTab ?? (await activeTabId());
        console.log('[MeetYou] Prompt chip: startRecording requested for tab', tabId);
        await startRecording(tabId);
        // A click in the page may not count as invoking the extension, so tabCapture can refuse;
        // the chip then tells the user to use the toolbar instead of failing silently.
        if (tabId !== undefined && (await loadCaptureState()).status === 'error') {
          notifyPromptProblem(tabId, 'start_failed');
        }
      });
      break;
    }
    case 'recording.stop':
    case 'capture.tab_ended':
      enqueueCapture(stopRecording);
      break;
    case 'recording.pause':
      enqueueCapture(pauseRecording);
      break;
    case 'recording.resume':
      enqueueCapture(resumeRecording);
      break;
    case 'recording.dismiss':
      enqueueCapture(async () => {
        await applyCaptureEvent({ type: 'dismissed' });
      });
      break;
    case 'capture.upload_idle':
      enqueueCapture(closeIfUploadsDone);
      break;
    case 'capture.mic_lost':
      enqueueCapture(async () => {
        await applyCaptureEvent({ type: 'mic_lost' });
      });
      break;
    case 'capture.link': {
      const link = parsed.link;
      enqueueCapture(async () => {
        await applyCaptureEvent({ type: 'link_changed', link });
      });
      break;
    }
    case 'capture.video': {
      const video = parsed.video;
      enqueueCapture(async () => {
        await applyCaptureEvent({ type: 'video_changed', video });
      });
      break;
    }
    case 'capture.stt': {
      const stt = parsed.stt;
      enqueueCapture(async () => {
        await applyCaptureEvent({ type: 'stt_changed', stt });
      });
      break;
    }
  }
  return false;
});

disableBrowserOpenedPanel();
configureExistingTabs().catch((error: unknown) => logError('configure tabs failed', error));
enqueueCapture(reconcileAfterRestart);
