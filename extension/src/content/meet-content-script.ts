/**
 * Google Meet adapter content script.
 *
 * Runs on meet.google.com, observes call state transitions (home, lobby, in_call, ended),
 * extracts meeting title and participant names, generates selector health telemetry,
 * and notifies extension components.
 *
 * Bundled as a classic IIFE script by esbuild (scripts/build.mjs).
 */
import { detectCallState, observeCallState } from '../adapters/meet/detector.ts';
import {
  generateSelectorHealthReport,
  type SelectorHealthReport,
} from '../adapters/meet/health.ts';
import { extractMeetingMetadata, type MeetingMetadata } from '../adapters/meet/metadata.ts';
import { detectMuteState, observeMuteState } from '../adapters/meet/mute-signal.ts';
import { observeActiveSpeakers } from '../adapters/meet/speaker-signal.ts';
import { PILL_LAYOUT_KEY } from './pill-model.ts';
import { PromptChip } from './prompt-chip.ts';
import { RecordingPill, type RecordingSnapshot } from './recording-pill.ts';
import { postChatMessage } from '../adapters/meet/chat.ts';
import {
  ACCOUNT_SETTINGS_KEY,
  accountSettingsFrom,
  RECORD_VIDEO_KEY,
  recordVideoFrom,
  videoAllowed,
} from '../settings.ts';

let stopObserving: (() => void) | null = null;
let stopMuteObserving: (() => void) | null = null;
let stopSpeakerObserving: (() => void) | null = null;
let tornDown = false;

/** After an extension reload or update this script's runtime is gone (`chrome.runtime.id`). */
function contextValid(): boolean {
  return chrome.runtime.id !== undefined;
}

/**
 * The orphaned script stops observing and removes its chip (its buttons would do nothing); the
 * Meet tab needs a reload to get the new script, whose chip then replaces any leftover.
 */
function teardown(): void {
  if (tornDown) return;
  tornDown = true;
  stopObserving?.();
  stopObserving = null;
  stopMuteObserving?.();
  stopMuteObserving = null;
  stopSpeakerObserving?.();
  stopSpeakerObserving = null;
  promptChip.unmount();
  recordingPill.unmount();
}

function notifyExtension(message: unknown): void {
  if (!contextValid()) {
    teardown();
    return;
  }
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // Extension context invalidated between the check and the call.
  }
}

const promptChip = new PromptChip(document, {
  onDismiss: () => {
    console.log('[MeetYou] Prompt chip: dismissed by user');
  },
});

const recordingPill = new RecordingPill(document, {
  onOpenPanel: () => notifyExtension({ target: 'background', type: 'pill.open-sidepanel' }),
  loadLayout: async () => {
    if (!contextValid()) return null;
    return (await chrome.storage.local.get(PILL_LAYOUT_KEY))[PILL_LAYOUT_KEY];
  },
  saveLayout: (layout) => {
    if (!contextValid()) return;
    chrome.storage.local.set({ [PILL_LAYOUT_KEY]: layout }).catch(() => undefined);
  },
});

// The prompt's reminder line says whether the screen will be recorded (DESIGN §8.2).
// The account settings (S4-12) decide whether the prompt is offered at all, and "Delete after
// notes" means audio only.
if (contextValid()) {
  const apply = (items: Record<string, unknown>) => {
    const account = accountSettingsFrom(items);
    promptChip.setOffered(account.offerPrompt);
    promptChip.setPostsNotice(account.consentMode !== 'off');
    promptChip.setRecordVideo(recordVideoFrom(items) && videoAllowed(account));
  };
  let latest: Record<string, unknown> = {};
  chrome.storage.local
    .get([RECORD_VIDEO_KEY, ACCOUNT_SETTINGS_KEY])
    .then((items) => {
      latest = items;
      apply(items);
    })
    .catch(() => undefined);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const video = changes[RECORD_VIDEO_KEY];
    const account = changes[ACCOUNT_SETTINGS_KEY];
    if (video === undefined && account === undefined) return;
    latest = {
      ...latest,
      ...(video !== undefined ? { [RECORD_VIDEO_KEY]: video.newValue } : {}),
      ...(account !== undefined ? { [ACCOUNT_SETTINGS_KEY]: account.newValue } : {}),
    };
    apply(latest);
  });
}

/** `recording.state` from the service worker, or its reply to `meet.page-ready`. */
function parseRecordingSnapshot(value: unknown): RecordingSnapshot | null {
  if (!isRecord(value) || typeof value.status !== 'string') return null;
  return {
    status: value.status,
    startedAt: typeof value.startedAt === 'number' ? value.startedAt : null,
    video: typeof value.video === 'string' ? value.video : 'off',
  };
}

function applyRecordingState(value: unknown): void {
  const snapshot = parseRecordingSnapshot(value);
  if (snapshot === null) return;
  promptChip.updateRecordingStatus(snapshot.status);
  recordingPill.update(snapshot);
}

function updateSignalObservers(state: string): void {
  if (state === 'in_call') {
    if (stopMuteObserving === null) {
      stopMuteObserving = observeMuteState(document, (event) => {
        console.log(`[MeetYou] Mic mute changed: muted=${event.muted}`);
        notifyExtension({ type: 'meet.mute-changed', muted: event.muted, at: event.at });
      });
    }
    if (stopSpeakerObserving === null) {
      stopSpeakerObserving = observeActiveSpeakers(document, (event) => {
        // AGENTS §7: no names in logs; Meet's own participant IDs are not logged either.
        console.log(`[MeetYou] Active speaker changed (self=${event.speaker.isSelf})`);
        notifyExtension({
          type: 'meet.speaker-active',
          participantId: event.speaker.participantId,
          displayName: event.speaker.displayName,
          isSelf: event.speaker.isSelf,
          at: event.at,
        });
      });
    }
  } else {
    stopMuteObserving?.();
    stopMuteObserving = null;
    stopSpeakerObserving?.();
    stopSpeakerObserving = null;
  }
}

function broadcastState(
  snapshot: ReturnType<typeof detectCallState>,
  metadata: MeetingMetadata,
  healthReport: SelectorHealthReport,
): void {
  if (!contextValid()) {
    teardown();
    return;
  }
  // AGENTS §7: Never log participant names or meeting titles. Log IDs and counts only.
  console.log(
    `[MeetYou] Call state: ${snapshot.state} | Participants: ${metadata.participants.length} | Health: ${healthReport.overallStatus}`,
  );

  if (healthReport.overallStatus === 'degraded') {
    console.warn('[MeetYou] Selector health is DEGRADED (fallback matched):', healthReport);
  } else if (healthReport.overallStatus === 'broken' && snapshot.state === 'in_call') {
    console.error('[MeetYou] Selector health is BROKEN:', healthReport);
  }

  // Update prompt chip visibility based on call state (DESIGN §8.2)
  promptChip.updateCallState(snapshot.state, snapshot.meetingCode);

  // Activate or teardown DOM signal observers for mute and active speaker (S1-08)
  updateSignalObservers(snapshot.state);

  notifyExtension({ type: 'meet.state-changed', snapshot, metadata, healthReport });
}

// Content scripts cannot read the recording state, so ask once: a reloaded Meet tab must not show
// the chip over a recording that is already running, and must show its recording pill.
if (contextValid()) {
  chrome.runtime
    .sendMessage({ type: 'meet.page-ready' })
    .then(applyRecordingState)
    .catch(() => undefined);
}

// Detection on load and on every change: `observeCallState` evaluates immediately, so the first
// state is broadcast exactly once.
stopObserving = observeCallState(document, (snapshot) => {
  const metadata = extractMeetingMetadata(document, window.location.href);
  const healthReport = generateSelectorHealthReport(document, snapshot.state);
  broadcastState(snapshot, metadata, healthReport);
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// 3. Respond to runtime messages
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRecord(message)) return;

  if (message.type === 'meet.get-state') {
    const current = detectCallState(document, window.location.href);
    const metadata = extractMeetingMetadata(document, window.location.href);
    const healthReport = generateSelectorHealthReport(document, current.state);
    const muteState = detectMuteState(document);
    sendResponse({ snapshot: current, metadata, healthReport, muteState });
  } else if (message.target === 'content' && message.type === 'recording.state') {
    applyRecordingState(message);
  } else if (
    message.target === 'content' &&
    message.type === 'meet.post-chat' &&
    typeof message.text === 'string'
  ) {
    // S4-07 consent notice; the text is the user's message and is never logged.
    postChatMessage(document, message.text.slice(0, 1000)).then(
      (ok) => sendResponse({ ok }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  return undefined;
});

window.addEventListener('beforeunload', () => {
  promptChip.unmount();
  recordingPill.unmount();
  stopMuteObserving?.();
  stopSpeakerObserving?.();
  stopObserving?.();
});
