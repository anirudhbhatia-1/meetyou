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
import { PromptChip } from './prompt-chip.ts';

let stopObserving: (() => void) | null = null;
let stopMuteObserving: (() => void) | null = null;
let stopSpeakerObserving: (() => void) | null = null;

/**
 * Best effort: after an extension reload this page keeps the old content script, whose runtime
 * is gone (`chrome.runtime.id` becomes undefined). It then stops observing instead of running a
 * dead observer for the rest of the call; the Meet tab needs a reload to get the new script.
 */
function notifyExtension(message: unknown): void {
  if (chrome.runtime.id === undefined) {
    stopObserving?.();
    stopObserving = null;
    stopMuteObserving?.();
    stopMuteObserving = null;
    stopSpeakerObserving?.();
    stopSpeakerObserving = null;
    return;
  }
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // Extension context invalidated between the check and the call.
  }
}

notifyExtension({ type: 'meet.page-ready' });

const promptChip = new PromptChip(document, {
  onStart: () => {
    console.log('[MeetYou] Prompt chip: user clicked Start');
    // Test user-gesture entry points for sidePanel.open() and tabCapture (S1-09)
    notifyExtension({ target: 'background', type: 'prompt.open-sidepanel' });
    notifyExtension({ target: 'background', type: 'prompt.start-recording' });
  },
  onDismiss: () => {
    console.log('[MeetYou] Prompt chip: dismissed by user');
  },
});

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
        // AGENTS §7: Do not log participant names; log ID only.
        console.log(
          `[MeetYou] Active speaker: ${event.speaker.participantId} (self=${event.speaker.isSelf})`,
        );
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
  promptChip.updateCallState(snapshot.state);

  // Activate or teardown DOM signal observers for mute and active speaker (S1-08)
  updateSignalObservers(snapshot.state);

  notifyExtension({ type: 'meet.state-changed', snapshot, metadata, healthReport });
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
  } else if (
    message.target === 'content' &&
    message.type === 'recording.state' &&
    typeof message.status === 'string'
  ) {
    promptChip.updateRecordingStatus(message.status);
  }
});

window.addEventListener('beforeunload', () => {
  promptChip.unmount();
  stopMuteObserving?.();
  stopSpeakerObserving?.();
  stopObserving?.();
});
