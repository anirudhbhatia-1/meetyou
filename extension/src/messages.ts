/**
 * Runtime messages between extension contexts (ARCHITECTURE §4.2). `chrome.runtime.sendMessage`
 * reaches every extension page, so each message names its `target` and receivers ignore the rest.
 */
export type Lane = 'me' | 'them';
export type LaneFlags = Record<Lane, boolean>;

export type CaptureFailure = 'tab_capture_failed' | 'audio_context_failed';

/** Connection to the gateway: `off` when this build or session does not stream. */
export type StreamLink = 'off' | 'connecting' | 'online' | 'reconnecting';

export type VideoStatus = 'off' | 'recording' | 'unsupported' | 'failed';

/** Live transcription health from the gateway (ws-protocol `health`, ARCHITECTURE §6.3). */
export type SttHealth = 'ok' | 'degraded' | 'down';

export type BackgroundMessage =
  | { target: 'background'; type: 'recording.start' }
  | { target: 'background'; type: 'recording.stop' }
  | { target: 'background'; type: 'recording.pause' }
  | { target: 'background'; type: 'recording.resume' }
  /** Side panel "Done": back to Ready after processing, notes ready, or an error. */
  | { target: 'background'; type: 'recording.dismiss' }
  | { target: 'background'; type: 'capture.tab_ended' }
  | { target: 'background'; type: 'capture.mic_lost' }
  | { target: 'background'; type: 'capture.link'; link: StreamLink }
  | { target: 'background'; type: 'capture.video'; video: VideoStatus }
  | { target: 'background'; type: 'capture.stt'; stt: SttHealth }
  /** Every uploadable video fragment is uploaded; the offscreen document may close (ADR-0011). */
  | { target: 'background'; type: 'capture.upload_idle' }
  /** Click on the Meet recording pill (DESIGN §8.4). */
  | { target: 'background'; type: 'pill.open-sidepanel' }
  /** Cloud mode sign-in from the side panel; replies `AuthReply`. */
  | { target: 'background'; type: 'auth.sign_in' }
  | { target: 'background'; type: 'auth.sign_out' }
  /** The offscreen document asks for an access token; replies `AccessTokenReply`. */
  | { target: 'background'; type: 'auth.token' };

export interface AuthReply {
  ok: boolean;
}

export interface AccessTokenReply {
  token: string | null;
}

/** A session the service worker started on the API, handed to the offscreen recorder. */
export interface StartedSession {
  sessionId: string;
  meetingId: string;
  streamUrl: string;
  streamToken: string;
}

export type OffscreenMessage =
  | {
      target: 'offscreen';
      type: 'capture.start';
      streamId: string;
      recordVideo: boolean;
      /** Cloud mode: the API session to stream to (absent with the dev gateway). */
      session?: StartedSession;
    }
  | { target: 'offscreen'; type: 'capture.stop' }
  | { target: 'offscreen'; type: 'capture.pause' }
  | { target: 'offscreen'; type: 'capture.resume' }
  | { target: 'offscreen'; type: 'capture.status' }
  /** Meet's mic mute on the recorded tab (FR-CAP-11, D-10). */
  | { target: 'offscreen'; type: 'capture.mic_muted'; muted: boolean };

export type SidePanelMessage =
  /** Per-lane RMS level in dBFS; `me` is null when the microphone lane is not captured. */
  | { target: 'sidepanel'; type: 'capture.levels'; me: number | null; them: number }
  | {
      target: 'sidepanel';
      type: 'transcript';
      final: boolean;
      lane: Lane;
      text: string;
      startMs: number;
      /** Diarized cluster of a `them` segment (e.g. "spk_2"), null when unknown. */
      speaker: string | null;
    }
  /** Video fragment upload (ADR-0011 §3.3): fragments left, and uploaded since the uploader started. */
  | { target: 'sidepanel'; type: 'video.upload'; pending: number; uploaded: number };

/** Offscreen reply to `capture.start`. `micError` is the DOMException name when the mic failed. */
export type CaptureStartResult =
  | {
      ok: true;
      sessionId: string;
      lanes: LaneFlags;
      micError: string | null;
      link: StreamLink;
      video: VideoStatus;
    }
  | { ok: false; reason: CaptureFailure };

/** Offscreen reply to `capture.stop`: `uploading` keeps the document open for the video upload. */
export interface CaptureStopReply {
  ok: boolean;
  uploading: boolean;
}

/** Offscreen reply to `capture.status`, used to reconcile after a service-worker restart. */
export interface CaptureStatusReply {
  active: boolean;
  /** Recording, stopping, draining audio or uploading video: the document must stay open. */
  busy: boolean;
}

/**
 * Call state from the Meet adapter's content script (S1-07 `meet.state-changed`). Only the state is
 * read here; metadata in the same message (title, names) is not used by the service worker.
 */
export type MeetCallState = 'not_meet' | 'home' | 'lobby' | 'in_call' | 'ended';

const CALL_STATES = new Set<string>(['not_meet', 'home', 'lobby', 'in_call', 'ended']);

export function parseMeetCallState(message: unknown): MeetCallState | null {
  if (!isRecord(message) || message.type !== 'meet.state-changed') return null;
  return parseMeetStateReply(message);
}

/** State from the content script's reply to `meet.get-state` (`{ snapshot, … }`). */
export function parseMeetStateReply(reply: unknown): MeetCallState | null {
  if (!isRecord(reply)) return null;
  const snapshot = reply.snapshot;
  if (!isRecord(snapshot) || typeof snapshot.state !== 'string') return null;
  return CALL_STATES.has(snapshot.state) ? (snapshot.state as MeetCallState) : null;
}

/** The Meet title from a `meet.get-state` reply; null when Meet shows none. */
export function parseMeetTitle(reply: unknown): string | null {
  if (!isRecord(reply) || !isRecord(reply.metadata)) return null;
  const title = reply.metadata.title;
  if (typeof title !== 'string') return null;
  const trimmed = title.trim().slice(0, 200);
  // The adapter's placeholder is not a real title; the web app names untitled meetings itself.
  return trimmed === '' || trimmed === 'Untitled Meeting' ? null : trimmed;
}

/** Meet's mic mute from a `meet.get-state` reply; null when the mic button was not found. */
export function parseMeetMuteReply(reply: unknown): boolean | null {
  if (!isRecord(reply) || !isRecord(reply.muteState)) return null;
  const muted = reply.muteState.isMuted;
  return typeof muted === 'boolean' ? muted : null;
}

/** Tab ID of a runtime message sender, when it came from a content script. */
export function senderTabId(sender: unknown): number | null {
  if (!isRecord(sender) || !isRecord(sender.tab) || typeof sender.tab.id !== 'number') return null;
  return sender.tab.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const LINKS = new Set<string>(['off', 'connecting', 'online', 'reconnecting']);
const VIDEO = new Set<string>(['off', 'recording', 'unsupported', 'failed']);
const LANES = new Set<string>(['me', 'them']);

function isLink(value: unknown): value is StreamLink {
  return typeof value === 'string' && LINKS.has(value);
}

const STT_HEALTH = new Set<string>(['ok', 'degraded', 'down']);

function isSttHealth(value: unknown): value is SttHealth {
  return typeof value === 'string' && STT_HEALTH.has(value);
}

function isVideo(value: unknown): value is VideoStatus {
  return typeof value === 'string' && VIDEO.has(value);
}

const SIMPLE_BACKGROUND = new Set<string>([
  'recording.start',
  'recording.stop',
  'recording.pause',
  'recording.resume',
  'recording.dismiss',
  'capture.tab_ended',
  'capture.mic_lost',
  'capture.upload_idle',
  'pill.open-sidepanel',
  'auth.sign_in',
  'auth.sign_out',
  'auth.token',
]);

export function parseBackgroundMessage(message: unknown): BackgroundMessage | null {
  if (!isRecord(message) || message.target !== 'background') return null;
  if (typeof message.type !== 'string') return null;
  if (SIMPLE_BACKGROUND.has(message.type)) {
    return { target: 'background', type: message.type } as BackgroundMessage;
  }
  if (message.type === 'capture.link' && isLink(message.link)) {
    return { target: 'background', type: 'capture.link', link: message.link };
  }
  if (message.type === 'capture.video' && isVideo(message.video)) {
    return { target: 'background', type: 'capture.video', video: message.video };
  }
  if (message.type === 'capture.stt' && isSttHealth(message.stt)) {
    return { target: 'background', type: 'capture.stt', stt: message.stt };
  }
  return null;
}

const SIMPLE_OFFSCREEN = new Set<string>([
  'capture.stop',
  'capture.pause',
  'capture.resume',
  'capture.status',
]);

export function parseOffscreenMessage(message: unknown): OffscreenMessage | null {
  if (!isRecord(message) || message.target !== 'offscreen') return null;
  if (typeof message.type !== 'string') return null;
  if (SIMPLE_OFFSCREEN.has(message.type)) {
    return { target: 'offscreen', type: message.type } as OffscreenMessage;
  }
  if (message.type === 'capture.mic_muted' && typeof message.muted === 'boolean') {
    return { target: 'offscreen', type: 'capture.mic_muted', muted: message.muted };
  }
  if (
    message.type === 'capture.start' &&
    typeof message.streamId === 'string' &&
    message.streamId.length > 0 &&
    typeof message.recordVideo === 'boolean'
  ) {
    const session = parseStartedSession(message.session);
    return {
      target: 'offscreen',
      type: 'capture.start',
      streamId: message.streamId,
      recordVideo: message.recordVideo,
      ...(session !== null ? { session } : {}),
    };
  }
  return null;
}

function isLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parseSidePanelMessage(message: unknown): SidePanelMessage | null {
  if (!isRecord(message) || message.target !== 'sidepanel') return null;
  if (message.type === 'capture.levels') {
    if (!isLevel(message.them) || (message.me !== null && !isLevel(message.me))) return null;
    return { target: 'sidepanel', type: 'capture.levels', me: message.me, them: message.them };
  }
  if (
    message.type === 'transcript' &&
    typeof message.final === 'boolean' &&
    typeof message.lane === 'string' &&
    LANES.has(message.lane) &&
    typeof message.text === 'string' &&
    isLevel(message.startMs) &&
    (message.speaker === null || typeof message.speaker === 'string')
  ) {
    return {
      target: 'sidepanel',
      type: 'transcript',
      final: message.final,
      lane: message.lane as Lane,
      text: message.text,
      startMs: message.startMs,
      speaker: message.speaker,
    };
  }
  if (message.type === 'video.upload' && isCount(message.pending) && isCount(message.uploaded)) {
    return {
      target: 'sidepanel',
      type: 'video.upload',
      pending: message.pending,
      uploaded: message.uploaded,
    };
  }
  return null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function parseCaptureStopReply(value: unknown): CaptureStopReply | null {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return null;
  return { ok: value.ok, uploading: value.uploading === true };
}

export function isLaneFlags(value: unknown): value is LaneFlags {
  return isRecord(value) && typeof value.me === 'boolean' && typeof value.them === 'boolean';
}

export function parseCaptureStartResult(value: unknown): CaptureStartResult | null {
  if (!isRecord(value)) return null;
  if (
    value.ok === true &&
    typeof value.sessionId === 'string' &&
    isLaneFlags(value.lanes) &&
    isLink(value.link) &&
    isVideo(value.video)
  ) {
    return {
      ok: true,
      sessionId: value.sessionId,
      lanes: { me: value.lanes.me, them: value.lanes.them },
      micError: typeof value.micError === 'string' ? value.micError : null,
      link: value.link,
      video: value.video,
    };
  }
  if (
    value.ok === false &&
    (value.reason === 'tab_capture_failed' || value.reason === 'audio_context_failed')
  ) {
    return { ok: false, reason: value.reason };
  }
  return null;
}

export function parseCaptureStatusReply(value: unknown): CaptureStatusReply | null {
  if (!isRecord(value) || typeof value.active !== 'boolean') return null;
  return { active: value.active, busy: value.busy === true };
}

function parseStartedSession(value: unknown): StartedSession | null {
  if (!isRecord(value)) return null;
  const { sessionId, meetingId, streamUrl, streamToken } = value;
  if (
    typeof sessionId !== 'string' ||
    typeof meetingId !== 'string' ||
    typeof streamUrl !== 'string' ||
    !/^wss:\/\//.test(streamUrl) ||
    typeof streamToken !== 'string'
  ) {
    return null;
  }
  return { sessionId, meetingId, streamUrl, streamToken };
}

export function parseAccessTokenReply(value: unknown): AccessTokenReply {
  return isRecord(value) && typeof value.token === 'string'
    ? { token: value.token }
    : { token: null };
}
