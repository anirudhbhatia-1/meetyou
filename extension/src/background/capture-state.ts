import { lightColors } from '@meetyou/design-tokens';

import {
  isLaneFlags,
  type CaptureFailure,
  type LaneFlags,
  type MeetCallState,
  type StreamLink,
  type SttHealth,
  type VideoStatus,
} from '../messages.ts';

/**
 * Recording state machine (ARCHITECTURE §4.3), persisted in `chrome.storage.session` so a
 * restarted service worker recovers it (§4.2).
 *
 * idle ─start─► starting ─started─► recording ⇄ paused
 *                  │                  │  ▲
 *                  │ failed           │  └─ link online ── reconnecting ◄─ link lost
 *                  ▼                  │ stop / tab closed / call ended
 *                error              stopping ─stopped─► processing (streamed) ─processed─► ready
 *                                                    └► idle (nothing streamed)
 *
 * `processing → ready`: the side panel follows the meeting on the API and sends `processed` once its
 * notes settle (ready, updated, too short or failed; S4-05).
 */
export type CaptureStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'reconnecting'
  | 'stopping'
  | 'processing'
  | 'ready'
  | 'error';

export type CaptureError =
  | CaptureFailure
  | 'not_meet_tab'
  | 'no_active_tab'
  | 'capture_not_allowed'
  | 'offscreen_failed'
  | 'capture_lost'
  /** Cloud mode: no account on this browser, or the session expired (DESIGN §9). */
  | 'signed_out'
  /** Cloud mode: the API did not start the session (network or server). */
  | 'server_unreachable';

export interface CaptureState {
  status: CaptureStatus;
  tabId: number | null;
  /** Meeting code of the recorded tab at start; a different or missing code means the call ended. */
  meetingCode: string | null;
  /** The Meet adapter has reported the recorded tab in the call since this recording started. */
  callJoined: boolean;
  sessionId: string | null;
  /** Wall-clock start (epoch ms) for the UI timer; the session clock itself lives offscreen. */
  startedAt: number | null;
  /** When the current pause began (epoch ms), or null while not paused. */
  pausedAt: number | null;
  /** Total length of earlier pauses; timers show recorded time only (DESIGN §8.6). */
  pausedMs: number;
  lanes: LaneFlags | null;
  micError: string | null;
  link: StreamLink;
  video: VideoStatus;
  /** Live transcript health; `degraded`/`down` = transcript delayed (DESIGN §9). */
  stt: SttHealth;
  error: CaptureError | null;
  /** Recorded time when a running recording failed: "stopped at {mm:ss}" (DESIGN §9). */
  stoppedAfterMs: number | null;
}

export type CaptureEvent =
  | { type: 'start_requested'; tabId: number; meetingCode: string | null; at: number }
  | {
      type: 'started';
      sessionId: string;
      lanes: LaneFlags;
      micError: string | null;
      link: StreamLink;
      video: VideoStatus;
    }
  | { type: 'paused'; at: number }
  | { type: 'resumed'; at: number }
  | { type: 'link_changed'; link: StreamLink }
  | { type: 'video_changed'; video: VideoStatus }
  | { type: 'stt_changed'; stt: SttHealth }
  | { type: 'mic_lost' }
  /** Another microphone was opened for the `me` lane (§9 "Choose microphone"). */
  | { type: 'mic_restored' }
  | { type: 'call_joined' }
  | { type: 'stop_requested' }
  | { type: 'stopped' }
  | { type: 'processed' }
  | { type: 'dismissed' }
  /** `at` is given when a running recording was lost, for the time it stopped at. */
  | { type: 'failed'; error: CaptureError; at?: number };

export const CAPTURE_STATE_KEY = 'capture';

export const IDLE_CAPTURE: CaptureState = {
  status: 'idle',
  tabId: null,
  meetingCode: null,
  callJoined: false,
  sessionId: null,
  startedAt: null,
  pausedAt: null,
  pausedMs: 0,
  lanes: null,
  micError: null,
  link: 'off',
  video: 'off',
  stt: 'ok',
  error: null,
  stoppedAfterMs: null,
};

/** Statuses during which the offscreen document holds live capture. */
export const CAPTURING: ReadonlySet<CaptureStatus> = new Set([
  'starting',
  'recording',
  'paused',
  'reconnecting',
  'stopping',
]);

/** A new recording may start from these; processing of an earlier one continues in the backend. */
export function canStart(state: CaptureState): boolean {
  return (
    state.status === 'idle' ||
    state.status === 'processing' ||
    state.status === 'ready' ||
    state.status === 'error'
  );
}

/** Live statuses that a stop request ends. */
export function canStop(state: CaptureState): boolean {
  return (
    state.status === 'starting' ||
    state.status === 'recording' ||
    state.status === 'paused' ||
    state.status === 'reconnecting'
  );
}

function linkStatus(link: StreamLink): 'recording' | 'reconnecting' {
  return link === 'reconnecting' ? 'reconnecting' : 'recording';
}

/** Returns the next state; events that do not apply to the current status leave it unchanged. */
export function nextCaptureState(state: CaptureState, event: CaptureEvent): CaptureState {
  switch (event.type) {
    case 'start_requested':
      if (!canStart(state)) return state;
      return {
        ...IDLE_CAPTURE,
        status: 'starting',
        tabId: event.tabId,
        meetingCode: event.meetingCode,
        startedAt: event.at,
      };
    case 'started':
      if (state.status !== 'starting') return state;
      return {
        ...state,
        status: linkStatus(event.link),
        sessionId: event.sessionId,
        lanes: event.lanes,
        micError: event.micError,
        link: event.link,
        video: event.video,
      };
    case 'paused':
      if (state.status !== 'recording' && state.status !== 'reconnecting') return state;
      return { ...state, status: 'paused', pausedAt: event.at };
    case 'resumed':
      if (state.status !== 'paused') return state;
      return {
        ...state,
        status: linkStatus(state.link),
        pausedAt: null,
        pausedMs: state.pausedMs + Math.max(0, event.at - (state.pausedAt ?? event.at)),
      };
    case 'link_changed':
      if (state.status === 'recording' || state.status === 'reconnecting') {
        return { ...state, link: event.link, status: linkStatus(event.link) };
      }
      if (state.status === 'paused' || state.status === 'stopping') {
        return { ...state, link: event.link };
      }
      return state;
    case 'video_changed':
      if (!CAPTURING.has(state.status)) return state;
      return { ...state, video: event.video };
    case 'stt_changed':
      if (!CAPTURING.has(state.status) || state.stt === event.stt) return state;
      return { ...state, stt: event.stt };
    case 'call_joined':
      if (!CAPTURING.has(state.status) || state.callJoined) return state;
      return { ...state, callJoined: true };
    case 'mic_lost':
      if (!CAPTURING.has(state.status) || state.lanes === null) return state;
      return { ...state, lanes: { ...state.lanes, me: false }, micError: 'TrackEnded' };
    case 'mic_restored':
      if (!CAPTURING.has(state.status) || state.lanes === null) return state;
      return { ...state, lanes: { ...state.lanes, me: true }, micError: null };
    case 'stop_requested':
      if (!canStop(state)) return state;
      return { ...state, status: 'stopping' };
    case 'stopped':
      if (state.status !== 'stopping') return state;
      // Only a recording that never had a gateway session (`local_…`, recorder.ts) has nothing to
      // process; one whose link dropped or was refused still streamed audio.
      if (state.sessionId === null || state.sessionId.startsWith('local_')) return IDLE_CAPTURE;
      return {
        ...state,
        status: 'processing',
        tabId: null,
        meetingCode: null,
        link: 'off',
        video: 'off',
        stt: 'ok',
      };
    case 'processed':
      if (state.status !== 'processing') return state;
      return { ...state, status: 'ready' };
    case 'dismissed':
      // Processing goes on in the backend; dismissing only returns this panel to Ready.
      if (state.status !== 'processing' && state.status !== 'ready' && state.status !== 'error') {
        return state;
      }
      return IDLE_CAPTURE;
    case 'failed':
      return {
        ...IDLE_CAPTURE,
        status: 'error',
        error: event.error,
        stoppedAfterMs:
          event.at !== undefined && CAPTURING.has(state.status) ? elapsedMs(state, event.at) : null,
      };
  }
}

const STATUSES = new Set<string>([
  'idle',
  'starting',
  'recording',
  'paused',
  'reconnecting',
  'stopping',
  'processing',
  'ready',
  'error',
]);
const ERRORS = new Set<string>([
  'tab_capture_failed',
  'audio_context_failed',
  'not_meet_tab',
  'no_active_tab',
  'capture_not_allowed',
  'offscreen_failed',
  'capture_lost',
  'signed_out',
  'server_unreachable',
]);
const LINKS = new Set<string>(['off', 'connecting', 'online', 'reconnecting']);
const VIDEO = new Set<string>(['off', 'recording', 'unsupported', 'failed']);
const STT = new Set<string>(['ok', 'degraded', 'down']);

/** Reads a stored state; anything malformed falls back to idle rather than trusting it. */
export function parseCaptureState(raw: unknown): CaptureState {
  if (typeof raw !== 'object' || raw === null) return IDLE_CAPTURE;
  const r = raw as Record<string, unknown>;
  if (typeof r.status !== 'string' || !STATUSES.has(r.status)) return IDLE_CAPTURE;
  return {
    status: r.status as CaptureStatus,
    tabId: typeof r.tabId === 'number' ? r.tabId : null,
    meetingCode: typeof r.meetingCode === 'string' ? r.meetingCode : null,
    callJoined: r.callJoined === true,
    sessionId: typeof r.sessionId === 'string' ? r.sessionId : null,
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : null,
    pausedAt: typeof r.pausedAt === 'number' ? r.pausedAt : null,
    pausedMs: typeof r.pausedMs === 'number' && r.pausedMs >= 0 ? r.pausedMs : 0,
    lanes: isLaneFlags(r.lanes) ? { me: r.lanes.me, them: r.lanes.them } : null,
    micError: typeof r.micError === 'string' ? r.micError : null,
    link: typeof r.link === 'string' && LINKS.has(r.link) ? (r.link as StreamLink) : 'off',
    video: typeof r.video === 'string' && VIDEO.has(r.video) ? (r.video as VideoStatus) : 'off',
    stt: typeof r.stt === 'string' && STT.has(r.stt) ? (r.stt as SttHealth) : 'ok',
    error: typeof r.error === 'string' && ERRORS.has(r.error) ? (r.error as CaptureError) : null,
    stoppedAfterMs:
      typeof r.stoppedAfterMs === 'number' && r.stoppedAfterMs >= 0 ? r.stoppedAfterMs : null,
  };
}

/** Recorded time at `now`, without pauses (the header and Meet pill timers). */
export function elapsedMs(state: CaptureState, now: number): number {
  if (state.startedAt === null) return 0;
  const until = state.pausedAt ?? now;
  return Math.max(0, until - state.startedAt - state.pausedMs);
}

export interface Badge {
  text: string;
  color: string;
}

/** Toolbar badge per status (ARCHITECTURE §16.1 "badge REC"), coloured from the design tokens. */
export function badgeFor(state: CaptureState): Badge {
  switch (state.status) {
    case 'recording':
      return { text: 'REC', color: lightColors.ember };
    case 'paused':
      return { text: '❚❚', color: lightColors.muted };
    case 'reconnecting':
      return { text: '…', color: lightColors.amberDot };
    case 'error':
      return { text: '!', color: lightColors.danger };
    default:
      return { text: '', color: lightColors.muted };
  }
}

/**
 * The recorded call is over when the tab, after being in the call, reports any other state.
 * Meet's "You left the meeting" screen is often not recognised as `ended` (its buttons may carry
 * no aria-label) and falls back to `lobby`, so `ended` alone is not enough (seen 2026-11-04).
 */
export function hasLeftCall(state: CaptureState, callState: MeetCallState): boolean {
  return state.callJoined && callState !== 'in_call';
}
