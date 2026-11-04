interface CallStateSnapshot {
  state: 'home' | 'lobby' | 'in_call' | 'ended';
  meetingCode: string | null;
  matchedSelector: string | null;
  timestamp: number;
}

interface ParticipantInfo {
  displayName: string;
  isSelf: boolean;
}

interface MeetingMetadata {
  title: string;
  meetingCode: string | null;
  participants: ParticipantInfo[];
  extractedAt: number;
}

interface SelectorHealthReport {
  version: string;
  timestamp: number;
  overallStatus: 'healthy' | 'degraded' | 'broken';
  primaryMatchCount: number;
  fallbackMatchCount: number;
  unmatchedCount: number;
}

const titleEl = document.querySelector<HTMLElement>('#call-state-title');
const descEl = document.querySelector<HTMLElement>('#call-state-desc');
const badgeEl = document.querySelector<HTMLElement>('#state-badge');
const codeEl = document.querySelector<HTMLElement>('#meeting-code-val');
const selectorEl = document.querySelector<HTMLElement>('#matched-selector-val');
const meetingTitleEl = document.querySelector<HTMLElement>('#meeting-title-val');
const participantsEl = document.querySelector<HTMLElement>('#participants-val');
const healthEl = document.querySelector<HTMLElement>('#selector-health-val');
const statusEl = document.querySelector<HTMLElement>('#connection-status');

function renderSnapshot(
  snapshot: CallStateSnapshot,
  metadata?: MeetingMetadata,
  healthReport?: SelectorHealthReport,
): void {
  if (
    badgeEl === null ||
    titleEl === null ||
    descEl === null ||
    codeEl === null ||
    selectorEl === null ||
    statusEl === null
  ) {
    return;
  }

  badgeEl.textContent = snapshot.state.replace('_', ' ').toUpperCase();
  badgeEl.className = `badge badge-${snapshot.state}`;
  codeEl.textContent = snapshot.meetingCode ?? 'None';
  selectorEl.textContent = snapshot.matchedSelector ?? 'None';

  if (metadata !== undefined) {
    if (meetingTitleEl !== null) {
      meetingTitleEl.textContent = metadata.title;
    }
    if (participantsEl !== null) {
      if (metadata.participants.length > 0) {
        participantsEl.textContent = metadata.participants
          .map((p) => `${p.displayName}${p.isSelf ? ' (You)' : ''}`)
          .join(', ');
      } else {
        participantsEl.textContent = 'None detected yet';
      }
    }
  }

  if (healthReport !== undefined && healthEl !== null) {
    const statusText =
      healthReport.overallStatus === 'healthy'
        ? 'Healthy (Primary matched)'
        : healthReport.overallStatus === 'degraded'
          ? `Degraded (${healthReport.fallbackMatchCount} fallback)`
          : `Broken (${healthReport.unmatchedCount} missed)`;

    healthEl.textContent = statusText;
    healthEl.className = `value health-${healthReport.overallStatus}`;
  }

  switch (snapshot.state) {
    case 'in_call':
      titleEl.textContent =
        metadata?.title && metadata.title !== 'Untitled Meeting'
          ? metadata.title
          : 'Active Meeting';
      descEl.textContent = `Connected to Google Meet call (${snapshot.meetingCode ?? 'active'}). Call state detector is live.`;
      statusEl.textContent = 'Ready for recording.';
      break;
    case 'lobby':
      titleEl.textContent = 'Waiting in Lobby';
      descEl.textContent =
        'You are in the green room / lobby. Recording is blocked until you join the call.';
      statusEl.textContent = 'Lobby detected — standby.';
      break;
    case 'ended':
      titleEl.textContent = 'Meeting Ended';
      descEl.textContent = 'The meeting has concluded.';
      statusEl.textContent = 'Call end detected via return-to-home or rejoin controls.';
      break;
    case 'home':
    default:
      titleEl.textContent = 'Ready when your meeting is.';
      descEl.textContent =
        'Join a Google Meet to start recording. MeetYou never adds a bot to the call.';
      statusEl.textContent = 'Extension shell is ready.';
      break;
  }
}

// 1. Listen for real-time state changes from the content script
chrome.runtime.onMessage.addListener((message) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'meet.state-changed' &&
    'snapshot' in message
  ) {
    const meta = 'metadata' in message ? (message.metadata as MeetingMetadata) : undefined;
    const health =
      'healthReport' in message ? (message.healthReport as SelectorHealthReport) : undefined;
    renderSnapshot(message.snapshot as CallStateSnapshot, meta, health);
  }
});

// 2. Query the active Meet tab for state immediately upon sidepanel mount
async function fetchCurrentState(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      const response = (await chrome.tabs.sendMessage(tab.id, {
        type: 'meet.get-state',
      })) as
        | {
            snapshot?: CallStateSnapshot;
            metadata?: MeetingMetadata;
            healthReport?: SelectorHealthReport;
          }
        | undefined;
      if (response?.snapshot !== undefined) {
        renderSnapshot(response.snapshot, response.metadata, response.healthReport);
      }
    }
  } catch {
    // Tab may still be loading content script.
  }
}

void fetchCurrentState();

export {};
