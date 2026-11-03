import {
  CAPTURE_STATE_KEY,
  parseCaptureState,
  type CaptureError,
  type CaptureState,
} from '../background/capture-state.ts';
import { parseSidePanelMessage, type BackgroundMessage, type Lane } from '../messages.ts';
import { idbDone, idbRequest, openMinutesDb, VIDEO_STORE } from '../offscreen/idb.ts';
import type { VideoFragmentRow } from '../offscreen/video-recorder.ts';
import { latestSessionParts } from './video-parts.ts';

/**
 * Developer control for Stage 1: start/stop/pause, per-lane meters, gateway link, live transcript
 * lines and the local video file, to verify S1-02..S1-13 in Chrome. Built in its own module and
 * DOM section so the side panel UI (S1-07, S4) can change freely.
 * TODO(S4): replace with the DESIGN.md recording controls; move strings to the i18n file.
 */
const ERROR_TEXT: Record<CaptureError, string> = {
  not_meet_tab: 'Open this panel on a Google Meet tab to record.',
  no_active_tab: 'Could not find the Meet tab. Click the Meet tab and try again.',
  capture_not_allowed:
    'Chrome did not allow capturing this tab. Click the extension icon in the toolbar (or press the shortcut), then press Start again.',
  tab_capture_failed: "Couldn't capture the Meet tab audio.",
  audio_context_failed: 'Something went wrong and recording stopped.',
  offscreen_failed: 'Something went wrong and recording stopped.',
  capture_lost: 'Recording stopped unexpectedly. Your audio so far is safe on this computer.',
};

const LINK_TEXT: Record<CaptureState['link'], string> = {
  off: 'Gateway: off (local capture only)',
  connecting: 'Gateway: connecting…',
  online: 'Gateway: online',
  reconnecting: 'Gateway: reconnecting — audio is buffered locally',
};

const VIDEO_TEXT: Record<CaptureState['video'], string> = {
  off: 'Video: off',
  recording: 'Video: recording',
  unsupported: 'Video: not supported by this Chrome',
  failed: 'Video: failed — audio continues',
};

const RECORD_VIDEO_KEY = 'dev.recordVideo';
const METER_MIN_DBFS = -60;
const MAX_LINES = 50;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

function meterRow(label: string): { row: HTMLElement; meter: HTMLMeterElement } {
  const meter = el('meter', { min: METER_MIN_DBFS, max: 0, low: -45, high: -6, value: -60 });
  const row = el('label', { className: 'status' });
  row.append(`${label} `, meter);
  return { row, meter };
}

const section = el('section', { ariaLabel: 'Capture check' });
const status = el('p', { className: 'status' });
status.setAttribute('role', 'status');
const linkLine = el('p', { className: 'status' });
const videoLine = el('p', { className: 'status' });
const startStop = el('button', { type: 'button' });
const pauseResume = el('button', { type: 'button' });
const videoToggle = el('input', { type: 'checkbox', checked: true });
const videoToggleRow = el('label', { className: 'status' });
videoToggleRow.append(videoToggle, ' Record video (Meet tab)');
const me = meterRow('Me (microphone)');
const them = meterRow('Them (Meet tab)');
const transcript = el('ol', { ariaLabel: 'Live transcript' });
const interim: Record<Lane, HTMLLIElement> = {
  me: el('li', { className: 'status' }),
  them: el('li', { className: 'status' }),
};
const download = el('button', { type: 'button', textContent: 'Show last video' });
const videoLinks = el('ul', { ariaLabel: 'Video parts' });
const clearVideo = el('button', { type: 'button', textContent: 'Delete local video' });
section.append(
  status,
  startStop,
  pauseResume,
  videoToggleRow,
  linkLine,
  videoLine,
  me.row,
  them.row,
  transcript,
  interim.me,
  interim.them,
  download,
  videoLinks,
  clearVideo,
);
(document.querySelector('main') ?? document.body).append(section);

let current: CaptureState = parseCaptureState(null);

function statusText(state: CaptureState): string {
  switch (state.status) {
    case 'idle':
      return 'Not recording.';
    case 'starting':
      return 'Starting…';
    case 'paused':
      return 'Paused. Nothing is recorded until you resume.';
    case 'stopping':
      return 'Stopping…';
    case 'processing':
      return 'Recording saved. Notes are processed on the server (Stage 2).';
    case 'ready':
      return 'Notes are ready.';
    case 'error':
      return state.error === null ? ERROR_TEXT.offscreen_failed : ERROR_TEXT[state.error];
    case 'recording':
    case 'reconnecting':
      return state.lanes?.me === true
        ? 'Recording both lanes.'
        : 'Recording the Meet tab only. Turn on your mic to include your voice.';
  }
}

function isLive(state: CaptureState): boolean {
  return (
    state.status === 'starting' ||
    state.status === 'recording' ||
    state.status === 'reconnecting' ||
    state.status === 'paused'
  );
}

function render(state: CaptureState): void {
  current = state;
  status.textContent = statusText(state);
  linkLine.textContent = LINK_TEXT[state.link];
  videoLine.textContent = VIDEO_TEXT[state.video];
  startStop.textContent = isLive(state) ? 'Stop recording' : 'Start recording';
  startStop.disabled = state.status === 'starting' || state.status === 'stopping';
  pauseResume.textContent = state.status === 'paused' ? 'Resume' : 'Pause';
  pauseResume.disabled = !(
    state.status === 'recording' ||
    state.status === 'reconnecting' ||
    state.status === 'paused'
  );
  videoToggle.disabled = isLive(state) || state.status === 'stopping';
  if (state.status !== 'recording' && state.status !== 'reconnecting') {
    me.meter.value = METER_MIN_DBFS;
    them.meter.value = METER_MIN_DBFS;
  }
}

function send(type: BackgroundMessage['type']): void {
  const message = { target: 'background', type } as BackgroundMessage;
  chrome.runtime.sendMessage(message).catch((error: unknown) => {
    console.error('sidepanel: send failed', type, error);
  });
}

startStop.addEventListener('click', () => {
  if (isLive(current)) {
    send('recording.stop');
  } else {
    transcript.replaceChildren();
    send('recording.start');
  }
});

pauseResume.addEventListener('click', () => {
  send(current.status === 'paused' ? 'recording.resume' : 'recording.pause');
});

videoToggle.addEventListener('change', () => {
  chrome.storage.local
    .set({ [RECORD_VIDEO_KEY]: videoToggle.checked })
    .catch((error: unknown) => console.error('sidepanel: save video setting failed', error));
});

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function showTranscript(final: boolean, lane: Lane, text: string, startMs: number): void {
  const line = `${formatMs(startMs)} ${lane === 'me' ? 'Me' : 'Them'}: ${text}`;
  if (!final) {
    interim[lane].textContent = line;
    return;
  }
  interim[lane].textContent = '';
  transcript.append(el('li', { textContent: line }));
  while (transcript.childElementCount > MAX_LINES) transcript.firstElementChild?.remove();
}

async function videoRows(): Promise<VideoFragmentRow[]> {
  const db = await openMinutesDb();
  try {
    const tx = db.transaction(VIDEO_STORE, 'readonly');
    return (await idbRequest(tx.objectStore(VIDEO_STORE).getAll())) as VideoFragmentRow[];
  } finally {
    db.close();
  }
}

let videoUrls: string[] = [];

/**
 * Lists every part of the newest recording as a download link. Pause/resume starts a new part, so
 * the part before a pause is kept and listed first; each part plays on its own.
 */
async function showLastVideo(): Promise<void> {
  for (const url of videoUrls) URL.revokeObjectURL(url);
  videoUrls = [];
  videoLinks.replaceChildren();
  const parts = latestSessionParts(await videoRows());
  if (parts.length === 0) {
    status.textContent = 'No local video yet.';
    return;
  }
  parts.forEach((part, i) => {
    const type = part.mimeType.split(';')[0] ?? 'video/webm';
    const url = URL.createObjectURL(
      new Blob(
        part.fragments.map((r) => r.blob),
        { type },
      ),
    );
    videoUrls.push(url);
    const ext = type === 'video/mp4' ? 'mp4' : 'webm';
    const link = el('a', {
      href: url,
      download: `minutes-part${i + 1}-${part.partId}.${ext}`,
      textContent: `Part ${i + 1} — from ${formatMs(part.startMs)} (${part.fragments.length} × 10 s)`,
    });
    const item = el('li');
    item.append(link);
    videoLinks.append(item);
  });
}

async function deleteLocalVideo(): Promise<void> {
  const db = await openMinutesDb();
  try {
    const tx = db.transaction(VIDEO_STORE, 'readwrite');
    tx.objectStore(VIDEO_STORE).clear();
    await idbDone(tx);
  } finally {
    db.close();
  }
  for (const url of videoUrls) URL.revokeObjectURL(url);
  videoUrls = [];
  videoLinks.replaceChildren();
  status.textContent = 'Local video deleted.';
}

download.addEventListener('click', () => {
  showLastVideo().catch((error: unknown) => console.error('sidepanel: list video failed', error));
});

clearVideo.addEventListener('click', () => {
  if (isLive(current)) return;
  // Developer control; S4 replaces it with the DESIGN.md confirmation dialog.
  if (!confirm('Delete all video stored on this computer?')) return;
  deleteLocalVideo().catch((error: unknown) => console.error('sidepanel: delete failed', error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  const change = changes[CAPTURE_STATE_KEY];
  if (areaName === 'session' && change !== undefined) {
    render(parseCaptureState(change.newValue));
  }
});

chrome.runtime.onMessage.addListener((message) => {
  const parsed = parseSidePanelMessage(message);
  if (parsed?.type === 'capture.levels') {
    me.meter.value = parsed.me ?? METER_MIN_DBFS;
    them.meter.value = parsed.them;
  } else if (parsed?.type === 'transcript') {
    showTranscript(parsed.final, parsed.lane, parsed.text, parsed.startMs);
  }
  return false;
});

render(current);
Promise.all([
  chrome.storage.session.get(CAPTURE_STATE_KEY),
  chrome.storage.local.get(RECORD_VIDEO_KEY),
])
  .then(([session, local]) => {
    videoToggle.checked = local[RECORD_VIDEO_KEY] !== false;
    render(parseCaptureState(session[CAPTURE_STATE_KEY]));
  })
  .catch((error: unknown) => console.error('sidepanel: read capture state failed', error));
