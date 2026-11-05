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
import { PromptChip } from './prompt-chip.ts';

/**
 * Best effort: after an extension reload this page keeps the old content script, whose runtime
 * is gone. `sendMessage` then throws or rejects; neither may surface as an unhandled error.
 */
function notifyExtension(message: unknown): void {
  try {
    chrome.runtime.sendMessage(message).catch(() => undefined);
  } catch {
    // Extension context invalidated.
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

  notifyExtension({ type: 'meet.state-changed', snapshot, metadata, healthReport });
}

// 1. Initial detection on script load
const initialSnapshot = detectCallState(document, window.location.href);
const initialMetadata = extractMeetingMetadata(document, window.location.href);
const initialHealth = generateSelectorHealthReport(document, initialSnapshot.state);
broadcastState(initialSnapshot, initialMetadata, initialHealth);

// 2. Continuous DOM observer for state changes
const stopObserving = observeCallState(document, (snapshot) => {
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
    sendResponse({ snapshot: current, metadata, healthReport });
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
  stopObserving();
});
