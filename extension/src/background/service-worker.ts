import { MEET_CHAT_NOTICE_ENABLED, type ProductEvent } from '@meetyou/contracts';

import {
  parseBackgroundMessage,
  parseMeetCallState,
  parseMeetStateReply,
  parseMeetMuteReply,
  parseSidePanelMessage,
  parseSpeakerSignal,
  parseMeetTitle,
  senderTabId,
  type MeetCallState,
  parseCaptureStartResult,
  parseCaptureStatusReply,
  parseCaptureStopReply,
  type AccessTokenReply,
  type AuthReply,
  type ConsentChoice,
  CONSENT_RESULT_KEY,
  type ConsentResult,
  type MicReply,
  type OffscreenMessage,
  type StartedSession,
} from '../messages.ts';
import {
  actionTitleFor,
  badgeFor,
  canStart,
  canStop,
  CAPTURE_STATE_KEY,
  CAPTURING,
  elapsedMs,
  hasLeftCall,
  nextCaptureState,
  parseCaptureState,
  type CaptureEvent,
  type CaptureState,
} from './capture-state.ts';
import { isMeetUrl, meetingCodeOf } from './meet-tab.ts';
import { LAST_RECORDING_KEY, parseLastRecording, type LastRecording } from '../last-recording.ts';
import {
  ACCOUNT_SETTINGS_KEY,
  accountSettingsFrom,
  noticeTextFor,
  RECORD_VIDEO_KEY,
  recordVideoFrom,
  toAccountSettings,
  videoAllowed,
  VIDEO_QUALITY_KEY,
  videoQualityFrom,
} from '../settings.ts';
import { notesKey, parseStoredNotes } from '../sidepanel/notes.ts';
import {
  discardApiMeeting,
  fetchApiMeetingProgress,
  fetchApiSettings,
  patchApiSettings,
  postApiConsentLog,
  postApiEvents,
  putApiNotes,
  startApiSession,
} from '../api-client.ts';
import { API_URL, GATEWAY_URL, GOOGLE_CLIENT_ID, WEB_URL } from '../build-config.ts';
import { deleteSessionData, openMinutesDb } from '../offscreen/idb.ts';
import { IdbFragmentQueue, uploadableSession } from '../offscreen/video-uploader.ts';
import { ExtensionAuth } from './auth.ts';
import {
  meetingFromNotificationId,
  NOTES_ALARM,
  NOTES_CHECK_MINUTES,
  NOTES_WATCH_KEY,
  NOTES_WATCH_MS,
  notesNotice,
  notesNotificationId,
  parseNotesWatch,
} from './notes-watch.ts';
import { resumeVideoUploads } from './video-resume.ts';

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
  trackTransition(previous, next, event);

  const badge = badgeFor(next);
  await Promise.all([
    chrome.action.setBadgeText({ text: badge.text }),
    chrome.action.setBadgeBackgroundColor({ color: badge.color }),
    chrome.action.setTitle({ title: actionTitleFor(next, Date.now()) }),
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
    // The pill counts recorded time only: moving the start by the paused total does that (the
    // pill hides its timer while paused).
    startedAt: state.startedAt === null ? null : state.startedAt + state.pausedMs,
    video: state.video,
  };
}

// Capture tasks run one at a time so a double click or a shortcut during start cannot interleave.
let captureQueue: Promise<void> = Promise.resolve();

function enqueueCapture(task: () => Promise<void>): void {
  captureQueue = captureQueue.then(task).catch((error: unknown) => {
    logError('capture task failed', error);
  });
}

type PropsOf<N extends ProductEvent['name']> = Extract<ProductEvent, { name: N }>['props'];

/**
 * Product analytics (S4-15): one event at a time (a few per meeting), best effort. Nothing is sent
 * without an account or while the cached account settings say the user opted out.
 */
function track<N extends ProductEvent['name']>(name: N, props: PropsOf<N>): void {
  if (auth === null) return;
  const event = { name, at: new Date().toISOString(), props } as ProductEvent;
  void (async () => {
    const account = accountSettingsFrom(await chrome.storage.local.get(ACCOUNT_SETTINGS_KEY));
    if (account.analyticsOptOut) return;
    const token = await auth?.accessToken();
    if (token == null) return;
    await postApiEvents(API_URL, token, [event]);
  })().catch((error: unknown) => logError('analytics failed', error));
}

/** Recording funnel events from state changes that end or fail a recording. */
function trackTransition(previous: CaptureState, next: CaptureState, event: CaptureEvent): void {
  if (event.type === 'failed' && next.error !== null) {
    track('recording_failed', { error: next.error });
  } else if (event.type === 'stopped' && previous.startedAt !== null) {
    track('recording_stopped', { durationMs: elapsedMs(previous, Date.now()) });
  }
}

async function failCapture(event: Extract<CaptureEvent, { type: 'failed' }>): Promise<void> {
  await closeOffscreenDocument().catch((error: unknown) => {
    logError('close offscreen after failure', error);
  });
  await applyCaptureEvent(event);
}

async function recordVideoSetting(): Promise<boolean> {
  const items = await chrome.storage.local.get([RECORD_VIDEO_KEY, ACCOUNT_SETTINGS_KEY]);
  return recordVideoFrom(items) && videoAllowed(accountSettingsFrom(items));
}

/** Refreshed at most this often (each Meet page load asks; Settings changes are rare). */
const SETTINGS_REFRESH_MS = 60_000;
let settingsFetchedAt = 0;

/**
 * Caches the account settings (S4-12) for the content script and the side panel, and resets the
 * panel's per-meeting video choice to the account default. Not while recording: the running
 * meeting keeps the choices it started with. Failures keep the last cached values.
 */
async function refreshAccountSettings(force = false): Promise<void> {
  if (auth === null) return;
  if (!force && Date.now() - settingsFetchedAt < SETTINGS_REFRESH_MS) return;
  try {
    const token = await auth.accessToken();
    if (token === null) return;
    const account = toAccountSettings(await fetchApiSettings(API_URL, token));
    settingsFetchedAt = Date.now();
    const update: Record<string, unknown> = { [ACCOUNT_SETTINGS_KEY]: account };
    if (canStart(await loadCaptureState())) {
      update[RECORD_VIDEO_KEY] = account.recordVideo && videoAllowed(account);
      update[VIDEO_QUALITY_KEY] = account.videoQuality;
    }
    await chrome.storage.local.set(update);
  } catch (error: unknown) {
    logError('settings refresh failed', error);
  }
}

async function followMeetMute(): Promise<boolean> {
  return accountSettingsFrom(await chrome.storage.local.get(ACCOUNT_SETTINGS_KEY)).followMeetMute;
}

/** Cloud mode only (S2-09): the build names an API. */
const auth =
  API_URL === '' ? null : new ExtensionAuth({ apiUrl: API_URL, googleClientId: GOOGLE_CLIENT_ID });

/**
 * Cloud mode: start the session on the API before capture (the meeting row and stream token come
 * from there). Undefined in dev builds; a failure is the recording's error.
 */
async function startCloudSession(
  tabId: number,
  meetingCode: string | null,
  recordVideo: boolean,
): Promise<StartedSession | undefined | 'signed_out' | 'server_unreachable'> {
  if (auth === null) return undefined;
  const title = await readMeetTitle(tabId);
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
      ...(title !== null ? { title } : {}),
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

/**
 * Capture failed after the API session was created: delete its meeting so a failed start does not
 * leave an empty "recording" in the library. Best effort; the start error is what the user sees.
 */
async function discardCloudSession(session: StartedSession | undefined): Promise<void> {
  if (auth === null || session === undefined) return;
  try {
    const token = await auth.accessToken();
    if (token !== null) await discardApiMeeting(API_URL, token, session.meetingId);
  } catch (error: unknown) {
    logError('discard API session failed', error);
  }
}

/**
 * The consent notice once recording runs (S4-07, DESIGN §8.5, FR-CON-01..03): One click follows the
 * panel's choice (from the Meet prompt, whose reminder says a note is posted, it posts); Automatic
 * posts; Off skips. Every outcome goes to the consent log; the panel shows "Posted in Meet chat"
 * or the copy banner. Runs beside the capture queue so a slow Meet never delays Stop.
 */
async function runConsentNotice(
  tabId: number,
  sessionId: string,
  meetingId: string | undefined,
  recordVideo: boolean,
  choice: ConsentChoice | undefined,
): Promise<void> {
  const account = accountSettingsFrom(await chrome.storage.local.get(ACCOUNT_SETTINGS_KEY));
  const mode = account.consentMode;
  const text = (choice?.text ?? noticeTextFor(account, recordVideo)).trim();
  let outcome: 'posted' | 'skipped' | 'failed' = 'skipped';
  if (mode !== 'off' && (choice?.post ?? true) && text !== '') {
    const reply = (await chrome.tabs
      .sendMessage(tabId, { target: 'content', type: 'meet.post-chat', text })
      .catch(() => null)) as { ok?: unknown } | null;
    outcome = reply?.ok === true ? 'posted' : 'failed';
  }
  const result: ConsentResult = { sessionId, outcome, text };
  await chrome.storage.local
    .set({ [CONSENT_RESULT_KEY]: result })
    .catch((error: unknown) => logError('save consent result failed', error));
  if (auth === null || meetingId === undefined) return;
  try {
    const token = await auth.accessToken();
    if (token === null) return;
    await postApiConsentLog(API_URL, token, {
      meetingId,
      mode,
      outcome,
      ...(outcome !== 'skipped' ? { noticeText: text } : {}),
      sentAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    logError('consent log failed', error);
  }
}

async function startRecording(tabId: number | undefined, consent?: ConsentChoice): Promise<void> {
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
  const videoQuality = videoQualityFrom(
    await chrome.storage.local.get([VIDEO_QUALITY_KEY, ACCOUNT_SETTINGS_KEY]),
  );
  const session = await startCloudSession(tabId, meetingCode, recordVideo);
  if (session === 'signed_out' || session === 'server_unreachable') {
    await applyCaptureEvent({ type: 'failed', error: session });
    return;
  }

  try {
    await ensureOffscreenDocument();
  } catch (error: unknown) {
    logError('offscreen create failed', error);
    await discardCloudSession(session);
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
    await discardCloudSession(session);
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
      videoQuality,
      ...(session !== undefined ? { session } : {}),
    });
  } catch (error: unknown) {
    logError('offscreen capture.start failed', error);
  }
  const result = parseCaptureStartResult(reply);
  if (result === null || !result.ok) {
    await discardCloudSession(session);
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
  await applyCaptureEvent({ type: 'video_quality_changed', quality: videoQuality, auto: false });
  track('recording_started', {
    video: result.video === 'recording',
    videoQuality,
    consentMode: MEET_CHAT_NOTICE_ENABLED
      ? accountSettingsFrom(await chrome.storage.local.get(ACCOUNT_SETTINGS_KEY)).consentMode
      : 'off',
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
  if (MEET_CHAT_NOTICE_ENABLED) {
    void runConsentNotice(tabId, result.sessionId, session?.meetingId, recordVideo, consent);
  }
  // Usually recording starts inside the call; the adapter only reports state changes, so ask.
  if ((await readCallState(tabId)) === 'in_call') await applyCaptureEvent({ type: 'call_joined' });
  // Already muted in Meet when recording starts: the adapter reports only changes (FR-CAP-11).
  if ((await followMeetMute()) && (await readMuteState(tabId)) === true) await forwardMute(true);
}

async function readMuteState(tabId: number): Promise<boolean | null> {
  try {
    return parseMeetMuteReply(await chrome.tabs.sendMessage(tabId, { type: 'meet.get-state' }));
  } catch {
    return null;
  }
}

/**
 * Meet's mute on the recorded tab reaches the recorder (FR-CAP-11, D-10 "follow Meet mute"): muted
 * mic audio is never stored, sent to STT or mixed into the video. Only when the user keeps
 * "Pause my mic when I'm muted in Meet" on (DESIGN §15.1).
 */
async function forwardMute(muted: boolean): Promise<void> {
  try {
    await sendToOffscreen({ target: 'offscreen', type: 'capture.mic_muted', muted });
  } catch (error: unknown) {
    logError('forward mute failed', error);
  }
}

/**
 * Sends a recording's notes to its meeting (S4-06, FR-NOTE). Only while the recording runs: the
 * list replaces the stored one, and after the call the notes are the summary's anchors.
 */
async function syncNotes(sessionId: string): Promise<void> {
  if (auth === null) return;
  const items = await chrome.storage.local.get([LAST_RECORDING_KEY, notesKey(sessionId)]);
  const last = parseLastRecording(items[LAST_RECORDING_KEY]);
  if (last?.sessionId !== sessionId || last.meetingId === undefined) return;
  const token = await auth.accessToken();
  if (token === null) return;
  await putApiNotes(API_URL, token, last.meetingId, parseStoredNotes(items[notesKey(sessionId)]));
}

async function stopRecording(): Promise<void> {
  const state = await loadCaptureState();
  if (!canStop(state)) {
    return;
  }
  // Before the end reaches the gateway: the summary job starts there and reads the notes.
  if (state.sessionId !== null) {
    await syncNotes(state.sessionId).catch((error: unknown) =>
      logError('notes sync failed', error),
    );
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
  const next = await applyCaptureEvent({ type: 'stopped' });
  if (next.status === 'processing') {
    await watchNotes().catch((error: unknown) => logError('notes watch failed', error));
  }
}

/** Starts following the last recording's notes for the "Notes ready" notification. */
async function watchNotes(): Promise<void> {
  const last = parseLastRecording(
    (await chrome.storage.local.get(LAST_RECORDING_KEY))[LAST_RECORDING_KEY],
  );
  if (auth === null || last?.meetingId === undefined) return;
  await chrome.storage.local.set({
    [NOTES_WATCH_KEY]: { meetingId: last.meetingId, since: Date.now() },
  });
  await chrome.alarms.create(NOTES_ALARM, {
    delayInMinutes: NOTES_CHECK_MINUTES,
    periodInMinutes: NOTES_CHECK_MINUTES,
  });
}

async function stopWatchingNotes(): Promise<void> {
  await Promise.all([
    chrome.alarms.clear(NOTES_ALARM),
    chrome.storage.local.remove(NOTES_WATCH_KEY),
  ]);
}

async function sidePanelOpen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] });
  return contexts.length > 0;
}

/** One alarm tick: notify and stop once the notes settle; a failed check waits for the next. */
async function checkNotes(): Promise<void> {
  const watch = parseNotesWatch((await chrome.storage.local.get(NOTES_WATCH_KEY))[NOTES_WATCH_KEY]);
  if (watch === null || auth === null || Date.now() - watch.since > NOTES_WATCH_MS) {
    await stopWatchingNotes();
    return;
  }
  const token = await auth.accessToken();
  if (token === null) {
    await stopWatchingNotes();
    return;
  }
  const progress = await fetchApiMeetingProgress(API_URL, token, watch.meetingId);
  const notice = notesNotice(progress.status, progress.title);
  if (notice === null) return;
  await stopWatchingNotes();
  // The open panel shows Ready itself (§8.7); the notification is for when the user has left it.
  if (await sidePanelOpen()) return;
  await chrome.notifications.create(notesNotificationId(watch.meetingId), {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/notification.png'),
    title: notice.title,
    message: notice.message,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== NOTES_ALARM) return;
  checkNotes().catch((error: unknown) => logError('notes check failed', error));
});

chrome.notifications.onClicked.addListener((notificationId) => {
  const meetingId = meetingFromNotificationId(notificationId);
  if (meetingId === null) return;
  chrome.notifications.clear(notificationId).catch(() => undefined);
  if (WEB_URL === '') return;
  chrome.tabs
    .create({ url: `${WEB_URL}#/meetings/${encodeURIComponent(meetingId)}` })
    .catch((error: unknown) => logError('open notes failed', error));
});

/**
 * DESIGN §9 "Stop and delete" (FR-CON-04), for when someone does not want to be recorded: capture
 * stops, the recorder closes at once (no further uploads), this computer's audio and video for the
 * call are removed, the meeting is deleted on the server (its recordings with it), and the local
 * notes go too. A failure on the server side still leaves nothing here and is logged.
 */
async function stopAndDelete(): Promise<void> {
  const state = await loadCaptureState();
  if (!canStop(state) || state.sessionId === null) return;
  const sessionId = state.sessionId;
  await applyCaptureEvent({ type: 'stop_requested' });
  try {
    await sendToOffscreen({ target: 'offscreen', type: 'capture.stop' });
  } catch (error: unknown) {
    logError('offscreen stop failed', error);
  }
  await closeOffscreenQuietly();
  try {
    const db = await openMinutesDb();
    try {
      await deleteSessionData(db, sessionId);
    } finally {
      db.close();
    }
  } catch (error: unknown) {
    logError('local delete failed', error);
  }
  const items = await chrome.storage.local.get(LAST_RECORDING_KEY);
  const last = parseLastRecording(items[LAST_RECORDING_KEY]);
  if (auth !== null && last?.sessionId === sessionId && last.meetingId !== undefined) {
    try {
      const token = await auth.accessToken();
      if (token !== null) await discardApiMeeting(API_URL, token, last.meetingId);
    } catch (error: unknown) {
      logError('meeting delete failed', error);
    }
  }
  await chrome.storage.local
    .remove([notesKey(sessionId), CONSENT_RESULT_KEY, LAST_RECORDING_KEY, NOTES_WATCH_KEY])
    .catch((error: unknown) => logError('local cleanup failed', error));
  await applyCaptureEvent({ type: 'stopped' });
  await applyCaptureEvent({ type: 'dismissed' });
}

async function closeOffscreenQuietly(): Promise<void> {
  try {
    await closeOffscreenDocument();
  } catch (error: unknown) {
    logError('close offscreen failed', error);
  }
}

/** ADR-0011 §3.3: fragments a closed browser left behind upload at startup (video-resume.ts). */
async function resumePendingVideo(): Promise<void> {
  await resumeVideoUploads({
    hasUploadTarget: API_URL !== '' || GATEWAY_URL !== '',
    idle: async () => canStart(await loadCaptureState()),
    signedIn: async () => auth === null || (await auth.accessToken()) !== null,
    pendingFragments: async () => {
      const db = await openMinutesDb();
      try {
        return await new IdbFragmentQueue(db).count(uploadableSession);
      } finally {
        db.close();
      }
    },
    openOffscreen: ensureOffscreenDocument,
  });
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
  await applyCaptureEvent({ type: 'paused', at: Date.now() });
}

async function resumeRecording(): Promise<void> {
  const state = await loadCaptureState();
  if (state.status !== 'paused') {
    return;
  }
  await sendToOffscreen({ target: 'offscreen', type: 'capture.resume' });
  await applyCaptureEvent({ type: 'resumed', at: Date.now() });
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
    await failCapture({ type: 'failed', error: 'capture_lost', at: Date.now() });
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

/** Meet's title for the API session; null when the content script has none or is gone. */
async function readMeetTitle(tabId: number): Promise<string | null> {
  try {
    return parseMeetTitle(await chrome.tabs.sendMessage(tabId, { type: 'meet.get-state' }));
  } catch {
    // No content script (e.g. reloaded extension): the meeting is simply untitled.
    return null;
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
  const tabId = tab.id;
  // Called synchronously so it runs inside the click's user gesture.
  chrome.sidePanel
    .open({ tabId })
    .catch((error: unknown) => logError('open side panel failed', error));
  // This click is what Chrome needs before tab capture: if the last start was refused for lack
  // of it, start again now instead of making the user press Start once more.
  void loadCaptureState().then((state) => {
    if (state.status === 'error' && state.error === 'capture_not_allowed') {
      enqueueCapture(() => startRecording(tabId));
    }
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  disableBrowserOpenedPanel();
  configureExistingTabs().catch((error: unknown) => logError('configure tabs failed', error));

  if (details.reason === 'install') {
    chrome.tabs
      .create({ url: 'onboarding/index.html' })
      .catch((error: unknown) => logError('open onboarding failed', error));
  }
  if (details.reason === 'update') enqueueCapture(resumePendingVideo);
});

chrome.runtime.onStartup.addListener(() => {
  void refreshAccountSettings(true);
  disableBrowserOpenedPanel();
  configureExistingTabs().catch((error: unknown) => logError('configure tabs failed', error));
  enqueueCapture(resumePendingVideo);
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

let titleTickAt = 0;

/**
 * DESIGN §8.3 tooltip timer. The offscreen document broadcasts level samples 4× a second while it
 * captures, and every extension context receives them, so they double as a clock here: the title
 * is refreshed once a second without a timer keeping the worker awake.
 */
function tickActionTitle(): void {
  const now = Date.now();
  if (now - titleTickAt < 1_000) return;
  titleTickAt = now;
  void loadCaptureState().then((state) => {
    if (state.status !== 'recording') return;
    chrome.action
      .setTitle({ title: actionTitleFor(state, Date.now()) })
      .catch((error: unknown) => logError('title update failed', error));
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (parseSidePanelMessage(message)?.type === 'capture.levels') {
    tickActionTitle();
    return false;
  }
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
      void refreshAccountSettings();
      // The content script asks once so its prompt chip never shows over a running recording.
      void loadCaptureState().then((state) => {
        // Another tab's recording shows no pill here (it belongs to the recorded tab), and no
        // prompt either: only one recording runs at a time (FR-REC-07).
        sendResponse(
          fromTab !== null && state.tabId === fromTab
            ? contentStateMessage(state)
            : {
                status: canStop(state) ? 'elsewhere' : 'idle',
                startedAt: null,
                video: 'off',
              },
        );
      });
      return true;
    }
    if (record.type === 'meet.mute-changed' && typeof record.muted === 'boolean') {
      const muted = record.muted;
      // Only the recorded tab's mute counts, and only while it is being recorded.
      enqueueCapture(async () => {
        const state = await loadCaptureState();
        if (
          fromTab !== null &&
          state.tabId === fromTab &&
          canStop(state) &&
          (await followMeetMute())
        ) {
          await forwardMute(muted);
        }
      });
      return false;
    }
    if (record.type === 'meet.speaker-active' && record.isSelf !== true) {
      // The user's own speech is the `me` lane; others name the `them` clusters (S3-04).
      const signal = parseSpeakerSignal(record);
      if (signal === null) return false;
      enqueueCapture(async () => {
        const state = await loadCaptureState();
        if (fromTab === null || state.tabId !== fromTab || !canStop(state)) return;
        try {
          await sendToOffscreen(signal);
        } catch (error: unknown) {
          // AGENTS §7: no names or participant IDs in logs.
          logError('forward speaker failed', error);
        }
      });
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
      () => {
        if (parsed.type === 'auth.sign_in') void refreshAccountSettings(true);
        reply(true);
      },
      (error: unknown) => {
        logError(`${parsed.type} failed`, error);
        reply(false);
      },
    );
    return true;
  }

  switch (parsed.type) {
    case 'recording.start': {
      const consent = parsed.consent;
      enqueueCapture(async () => startRecording(await activeTabId(), consent));
      break;
    }
    case 'recording.stop_delete':
      enqueueCapture(stopAndDelete);
      break;
    case 'recording.mic': {
      const deviceId = parsed.deviceId;
      enqueueCapture(async () => {
        const state = await loadCaptureState();
        if (!CAPTURING.has(state.status)) {
          sendResponse({ ok: false } satisfies MicReply);
          return;
        }
        const reply = (await sendToOffscreen({
          target: 'offscreen',
          type: 'capture.mic',
          deviceId,
        }).catch(() => null)) as MicReply | null;
        if (reply?.ok === true) await applyCaptureEvent({ type: 'mic_restored' });
        sendResponse(reply ?? { ok: false });
      });
      return true;
    }
    case 'recording.switch':
      enqueueCapture(async () => {
        const tabId = await activeTabId();
        const state = await loadCaptureState();
        if (tabId === undefined || state.tabId === tabId) return;
        await stopRecording();
        // The account's consent mode decides the notice, as for a start from the Meet prompt.
        await startRecording(tabId);
      });
      break;
    case 'recording.processed':
      enqueueCapture(async () => {
        await applyCaptureEvent({ type: 'processed' });
      });
      break;
    case 'meeting.progress': {
      const sessionId = parsed.sessionId;
      void (async () => {
        try {
          const last = parseLastRecording(
            (await chrome.storage.local.get(LAST_RECORDING_KEY))[LAST_RECORDING_KEY],
          );
          const token = auth === null ? null : await auth.accessToken();
          if (last?.sessionId !== sessionId || last.meetingId === undefined || token === null) {
            sendResponse({ progress: null });
            return;
          }
          sendResponse({
            progress: await fetchApiMeetingProgress(API_URL, token, last.meetingId),
          });
        } catch (error: unknown) {
          logError('meeting progress failed', error);
          sendResponse({ progress: null });
        }
      })();
      return true;
    }
    case 'notes.sync': {
      const sessionId = parsed.sessionId;
      enqueueCapture(async () => {
        const state = await loadCaptureState();
        if (state.sessionId !== sessionId || !canStop(state)) return;
        await syncNotes(sessionId).catch((error: unknown) => logError('notes sync failed', error));
      });
      break;
    }
    case 'settings.patch': {
      const patch = parsed.patch;
      void (async () => {
        try {
          const token = auth === null ? null : await auth.accessToken();
          if (token === null) {
            sendResponse({ ok: false } satisfies AuthReply);
            return;
          }
          await patchApiSettings(API_URL, token, patch);
          await refreshAccountSettings(true);
          sendResponse({ ok: true } satisfies AuthReply);
        } catch (error: unknown) {
          logError('settings patch failed', error);
          sendResponse({ ok: false } satisfies AuthReply);
        }
      })();
      return true;
    }
    case 'pill.open-sidepanel':
      // From a trusted click on the recording pill; a refusal leaves the toolbar icon as the way in.
      if (fromTab !== null) {
        chrome.sidePanel.open({ tabId: fromTab }).catch((error: unknown) => {
          logError('pill: sidePanel.open failed', error);
        });
      }
      break;
    case 'recording.stop':
    case 'capture.tab_ended':
    case 'capture.limit_reached':
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
    case 'capture.video_quality': {
      const { quality, auto } = parsed;
      enqueueCapture(async () => {
        await applyCaptureEvent({ type: 'video_quality_changed', quality, auto });
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
