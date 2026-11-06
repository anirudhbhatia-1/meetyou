import type { CaptureError, CaptureState } from '../background/capture-state.ts';
import type { StreamLink, VideoStatus } from '../messages.ts';

export { formatClock } from '../format.ts';

/**
 * What the side panel shows for each capture state (DESIGN §8.5–§8.7, §9). Pure, so every state is
 * unit-tested; the components only map these to markup. Status is always text as well as colour.
 * TODO(S4-16): move the strings to the i18n file.
 */
export type Tone = 'idle' | 'live' | 'paused' | 'warn' | 'error' | 'done';

export interface Header {
  label: string;
  tone: Tone;
}

/** The panel body for a state. */
export type View = 'ready' | 'live' | 'processing' | 'ready_notes' | 'error';

export function viewFor(state: CaptureState): View {
  switch (state.status) {
    case 'idle':
      return 'ready';
    case 'starting':
    case 'recording':
    case 'paused':
    case 'reconnecting':
    case 'stopping':
      return 'live';
    case 'processing':
      return 'processing';
    case 'ready':
      return 'ready_notes';
    case 'error':
      return 'error';
  }
}

/** `micError` the state machine sets when the mic track ends mid-recording (capture-state.ts). */
const MIC_LOST = 'TrackEnded';

/** How the mic lane is missing, if it is: lost mid-call, or not available at start (§9). */
export function micProblem(state: CaptureState): 'lost' | 'denied' | null {
  if (state.lanes === null || state.lanes.me) return null;
  return state.micError === MIC_LOST ? 'lost' : 'denied';
}

export function headerFor(state: CaptureState): Header {
  switch (state.status) {
    case 'idle':
      return { label: 'Not recording', tone: 'idle' };
    case 'starting':
      return { label: 'About to start', tone: 'idle' };
    case 'recording':
      // Mic lost mid-call (§9): the rest of the call is still recorded, so amber, not red.
      if (micProblem(state) === 'lost') return { label: 'Your mic stopped', tone: 'warn' };
      return state.stt === 'ok'
        ? { label: 'Recording', tone: 'live' }
        : { label: 'Recording — transcript delayed', tone: 'warn' };
    case 'paused':
      return { label: 'Paused', tone: 'paused' };
    case 'reconnecting':
      return { label: 'Reconnecting', tone: 'warn' };
    case 'stopping':
      return { label: 'Finishing up', tone: 'done' };
    case 'processing':
    case 'ready':
      return { label: 'Done', tone: 'done' };
    case 'error':
      return { label: 'Recording stopped', tone: 'error' };
  }
}

/** Lane health row (§8.6). `off` is a build without a gateway: everything stays on this computer. */
export function connectionFor(link: StreamLink): { text: string; tone: 'ok' | 'warn' | 'error' } {
  switch (link) {
    case 'online':
      return { text: 'Good connection', tone: 'ok' };
    case 'connecting':
      return { text: 'Connecting…', tone: 'warn' };
    case 'reconnecting':
      return { text: 'Offline', tone: 'error' };
    case 'off':
      return { text: 'Saved on this computer', tone: 'ok' };
  }
}

/** Video status line (§8.6, §9 "Video stopped"). */
export function videoLineFor(video: VideoStatus): { recording: boolean; text: string } {
  switch (video) {
    case 'recording':
      return { recording: true, text: 'Recording screen' };
    case 'off':
      return { recording: false, text: 'Video off' };
    case 'unsupported':
      return { recording: false, text: 'Video off — this Chrome cannot record it' };
    case 'failed':
      return { recording: false, text: 'Video off' };
  }
}

export const ERROR_TEXT: Record<CaptureError, string> = {
  not_meet_tab: 'Open this panel on a Google Meet tab to record.',
  no_active_tab: 'We could not find the Meet tab. Click the Meet tab and try again.',
  capture_not_allowed:
    'Chrome did not allow recording this tab. Click the Minutes icon in the toolbar, then press Start again.',
  tab_capture_failed: "We couldn't record the Meet tab's sound.",
  audio_context_failed: 'Something went wrong and recording stopped.',
  offscreen_failed: 'Something went wrong and recording stopped.',
  capture_lost: 'Something went wrong and recording stopped. Your audio so far is safe.',
  signed_out: 'Sign in again to keep your notes.',
  server_unreachable: "We couldn't reach Minutes. Check your connection and try again.",
};

/** Upload progress for "Uploading video — N%" (§8.7); null when nothing is waiting. */
export function uploadPercent(pending: number, uploaded: number): number | null {
  if (pending <= 0) return null;
  return Math.floor((uploaded / (uploaded + pending)) * 100);
}

/** Below this the Meet tab counts as silent (§9 "Meet tab silent ≥ 15 s"). */
export const SILENT_DBFS = -55;
export const SILENT_AFTER_MS = 15_000;

/**
 * Tracks how long the Meet tab has been silent while the mic has signal. Returns the next
 * silent-since time (null when not silent) from one level sample.
 */
export function nextSilentSince(
  silentSince: number | null,
  me: number | null,
  them: number,
  now: number,
): number | null {
  const tabSilent = them < SILENT_DBFS;
  const micHasSignal = me !== null && me >= SILENT_DBFS;
  if (!tabSilent) return null;
  if (silentSince !== null) return silentSince;
  return micHasSignal ? now : null;
}
