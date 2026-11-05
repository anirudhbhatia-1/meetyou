import {
  parseBackgroundMessage,
  parseMeetCallState,
  parseMeetStateReply,
  senderTabId,
  type MeetCallState,
  parseCaptureStartResult,
  parseCaptureStatusReply,
  parseCaptureStopReply,
  type OffscreenMessage,
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

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/index.html';
/** Developer toggle until the settings page exists (S4); ADR-0011 default is on. */
const RECORD_VIDEO_KEY = 'dev.recordVideo';
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
    chrome.tabs
      .sendMessage(tabId, { target: 'content', type: 'recording.state', status: next.status })
      .catch(() => undefined);
  }
  return next;
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
  const items = await chrome.storage.local.get(RECORD_VIDEO_KEY);
  return items[RECORD_VIDEO_KEY] !== false;
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

  await applyCaptureEvent({
    type: 'start_requested',
    tabId,
    meetingCode: meetingCodeOf(tab.url),
    at: Date.now(),
  });
  const recordVideo = await recordVideoSetting();

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
    });
  } catch (error: unknown) {
    logError('offscreen capture.start failed', error);
  }
  const result = parseCaptureStartResult(reply);
  if (result === null || !result.ok) {
    await failCapture({ type: 'failed', error: result?.reason ?? 'offscreen_failed' });
    return;
  }
  await applyCaptureEvent({
    type: 'started',
    sessionId: result.sessionId,
    lanes: result.lanes,
    micError: result.micError,
    link: result.link,
    video: result.video,
  });
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
  if (canStart(await loadCaptureState())) await closeOffscreenQuietly();
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

chrome.runtime.onMessage.addListener((message, sender) => {
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

  const parsed = parseBackgroundMessage(message);
  if (parsed === null) {
    return false;
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
          });
      }
      break;
    }
    case 'prompt.start-recording': {
      enqueueCapture(async () => {
        const tabId = fromTab ?? (await activeTabId());
        console.log('[MeetYou] Prompt chip: startRecording requested for tab', tabId);
        await startRecording(tabId);
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
  }
  return false;
});

disableBrowserOpenedPanel();
configureExistingTabs().catch((error: unknown) => logError('configure tabs failed', error));
enqueueCapture(reconcileAfterRestart);
