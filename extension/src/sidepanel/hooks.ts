import { useToast } from '@meetyou/ui';
import { useEffect, useReducer, useRef, useState } from 'react';

import type { MeetingProgressView } from '../api-client.ts';

import {
  CAPTURE_STATE_KEY,
  parseCaptureState,
  type CaptureState,
} from '../background/capture-state.ts';
import {
  parseMeetCallState,
  parseSidePanelMessage,
  senderTabId,
  type BackgroundMessage,
  type ConsentChoice,
  type MeetCallState,
} from '../messages.ts';
import { parseParticipants, type ParticipantName } from './speaker-label.ts';
import { applyTranscript, EMPTY_TRANSCRIPT, type TranscriptView } from './transcript-model.ts';

/** Start recording, with the consent step's answer when it was shown (DESIGN §8.5). */
export function sendStart(consent?: ConsentChoice): void {
  const message: BackgroundMessage = {
    target: 'background',
    type: 'recording.start',
    ...(consent !== undefined ? { consent } : {}),
  };
  chrome.runtime.sendMessage(message).catch((error: unknown) => {
    console.error('sidepanel: start failed', error);
  });
}

export function send(type: BackgroundMessage['type']): void {
  const message = { target: 'background', type } as BackgroundMessage;
  chrome.runtime.sendMessage(message).catch((error: unknown) => {
    console.error('sidepanel: send failed', type, error);
  });
}

/** The recording state machine, as the service worker persists it (ARCHITECTURE §4.3). */
export function useCaptureState(): CaptureState {
  const [state, setState] = useState<CaptureState>(() => parseCaptureState(null));
  useEffect(() => {
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      const change = changes[CAPTURE_STATE_KEY];
      if (areaName === 'session' && change !== undefined) {
        setState(parseCaptureState(change.newValue));
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    chrome.storage.session
      .get(CAPTURE_STATE_KEY)
      .then((items) => setState(parseCaptureState(items[CAPTURE_STATE_KEY])))
      .catch((error: unknown) => console.error('sidepanel: read capture state failed', error));
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return state;
}

/** Side panels are per tab (configureSidePanel): the panel belongs to the tab active when it opened. */
export function usePanelTabId(): number | null {
  const [tabId, setTabId] = useState<number | null>(null);
  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setTabId(tab?.id ?? null))
      .catch((error: unknown) => console.error('sidepanel: tab query failed', error));
  }, []);
  return tabId;
}

export interface SelectorHealth {
  overallStatus: 'healthy' | 'degraded' | 'broken';
  fallbackMatchCount: number;
  unmatchedCount: number;
}

export interface MeetInfo {
  callState: MeetCallState | null;
  meetingCode: string | null;
  participants: ParticipantName[];
  health: SelectorHealth | null;
}

const PARTICIPANTS_REFRESH_MS = 15_000;

function parseHealth(value: unknown): SelectorHealth | null {
  const report = (value as { healthReport?: unknown } | null)?.healthReport;
  if (typeof report !== 'object' || report === null) return null;
  const r = report as Record<string, unknown>;
  if (
    (r.overallStatus === 'healthy' ||
      r.overallStatus === 'degraded' ||
      r.overallStatus === 'broken') &&
    typeof r.fallbackMatchCount === 'number' &&
    typeof r.unmatchedCount === 'number'
  ) {
    return {
      overallStatus: r.overallStatus,
      fallbackMatchCount: r.fallbackMatchCount,
      unmatchedCount: r.unmatchedCount,
    };
  }
  return null;
}

function parseMeetingCode(value: unknown): string | null {
  const snapshot = (value as { snapshot?: unknown } | null)?.snapshot;
  const code = (snapshot as { meetingCode?: unknown } | null)?.meetingCode;
  return typeof code === 'string' ? code : null;
}

/**
 * Call state, participant names and selector health from this panel's Meet tab only. The adapter
 * re-reads names only on call-state changes, so the panel also asks periodically.
 */
export function useMeetInfo(tabId: number | null): MeetInfo {
  const [info, setInfo] = useState<MeetInfo>({
    callState: null,
    meetingCode: null,
    participants: [],
    health: null,
  });
  useEffect(() => {
    if (tabId === null) return;
    const merge = (value: unknown): void => {
      const callState = parseMeetCallState(value) ?? parseReplyState(value);
      setInfo((prev) => ({
        callState: callState ?? prev.callState,
        meetingCode: parseMeetingCode(value) ?? prev.meetingCode,
        participants: parseParticipants(value) ?? prev.participants,
        health: parseHealth(value) ?? prev.health,
      }));
    };
    const onMessage = (message: unknown, sender: unknown): boolean => {
      if (senderTabId(sender) === tabId && parseMeetCallState(message) !== null) merge(message);
      return false;
    };
    const refresh = (): void => {
      // No reply means the Meet adapter is not loaded in this tab yet; labels fall back to Me/Them.
      chrome.tabs
        .sendMessage(tabId, { type: 'meet.get-state' })
        .then(merge)
        .catch(() => undefined);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    refresh();
    const timer = setInterval(refresh, PARTICIPANTS_REFRESH_MS);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      clearInterval(timer);
    };
  }, [tabId]);
  return info;
}

function parseReplyState(value: unknown): MeetCallState | null {
  const state = (value as { snapshot?: { state?: unknown } } | null)?.snapshot?.state;
  return state === 'home' || state === 'lobby' || state === 'in_call' || state === 'ended'
    ? state
    : null;
}

export interface Levels {
  me: number | null;
  them: number;
}

export interface LiveFeed {
  levels: Levels | null;
  transcript: TranscriptView;
  upload: { pending: number; uploaded: number } | null;
}

type FeedAction =
  | { type: 'reset' }
  | { type: 'levels'; levels: Levels }
  | {
      type: 'transcript';
      update: Parameters<typeof applyTranscript>[1];
    }
  | { type: 'upload'; pending: number; uploaded: number };

const EMPTY_FEED: LiveFeed = { levels: null, transcript: EMPTY_TRANSCRIPT, upload: null };

function feedReducer(feed: LiveFeed, action: FeedAction): LiveFeed {
  switch (action.type) {
    case 'reset':
      return { ...EMPTY_FEED, upload: feed.upload };
    case 'levels':
      return { ...feed, levels: action.levels };
    case 'transcript':
      return { ...feed, transcript: applyTranscript(feed.transcript, action.update) };
    case 'upload':
      return { ...feed, upload: { pending: action.pending, uploaded: action.uploaded } };
  }
}

/**
 * Levels, transcript lines and video upload progress broadcast by the offscreen document. The
 * transcript starts over when a new recording starts (a new `startedAt`).
 */
export function useLiveFeed(startedAt: number | null): LiveFeed {
  const [feed, dispatch] = useReducer(feedReducer, EMPTY_FEED);
  const lastStart = useRef(startedAt);
  useEffect(() => {
    if (startedAt !== null && startedAt !== lastStart.current) dispatch({ type: 'reset' });
    lastStart.current = startedAt;
  }, [startedAt]);
  useEffect(() => {
    const onMessage = (message: unknown): boolean => {
      const parsed = parseSidePanelMessage(message);
      if (parsed?.type === 'capture.levels') {
        dispatch({ type: 'levels', levels: { me: parsed.me, them: parsed.them } });
      } else if (parsed?.type === 'transcript') {
        dispatch({ type: 'transcript', update: parsed });
      } else if (parsed?.type === 'video.upload') {
        dispatch({ type: 'upload', pending: parsed.pending, uploaded: parsed.uploaded });
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);
  return feed;
}

/** DESIGN §9 session limit (FR-REC-08): one toast when the offscreen document warns. */
export function useLimitWarningToast(): void {
  const toast = useToast();
  useEffect(() => {
    const onMessage = (message: unknown): boolean => {
      if (parseSidePanelMessage(message)?.type === 'capture.limit_warning') {
        toast({ message: 'Recording will stop in 15 minutes (4-hour limit).' });
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [toast]);
}

/** Re-renders every `intervalMs` while `active`, for the header timer. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

/** A value from `chrome.storage.local`, with a setter that writes it back. */
export function useLocalSetting<T>(
  key: string,
  parse: (items: Record<string, unknown>) => T,
): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    chrome.storage.local
      .get(key)
      .then((items) => setValue(parse(items)))
      .catch((error: unknown) => console.error('sidepanel: read setting failed', error));
    // `parse` is a module-level function, so only `key` decides when to re-read.
  }, [key]);
  const save = (next: T): void => {
    setValue(next);
    chrome.storage.local
      .set({ [key]: next })
      .catch((error: unknown) => console.error('sidepanel: save setting failed', error));
  };
  return [value, save];
}

/** A value from `chrome.storage.local` that follows later changes (another context writes it). */
export function useStoredValue<T>(key: string, parse: (value: unknown) => T): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    chrome.storage.local
      .get(key)
      .then((items) => {
        if (live) setValue(parse(items[key]));
      })
      .catch((error: unknown) => console.error('sidepanel: read value failed', error));
    const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const change = changes[key];
      if (area === 'local' && change !== undefined) setValue(parse(change.newValue));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      live = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
    // `parse` is a module-level function, so only `key` decides when to re-read.
  }, [key]);
  return value;
}

const PROGRESS_POLL_MS = 3_000;

/**
 * The last recording's notes on the server (S4-05): asked through the service worker (it holds the
 * token) every few seconds while the panel shows Processing or Ready.
 */
export function useMeetingProgress(
  sessionId: string | null,
  active: boolean,
): MeetingProgressView | null {
  const [progress, setProgress] = useState<MeetingProgressView | null>(null);
  useEffect(() => {
    setProgress(null);
    if (!active || sessionId === null) return undefined;
    let live = true;
    const settled = new Set(['ready', 'updated', 'too_short', 'failed']);
    const tick = async () => {
      const reply = (await chrome.runtime
        .sendMessage({ target: 'background', type: 'meeting.progress', sessionId })
        .catch(() => null)) as { progress?: MeetingProgressView | null } | null;
      if (!live || reply?.progress == null) return;
      setProgress(reply.progress);
      // Nothing changes after the notes settle: polling on (two API GETs a tick) was waste.
      if (settled.has(reply.progress.status)) clearInterval(timer);
    };
    const timer = setInterval(() => void tick(), PROGRESS_POLL_MS);
    void tick();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sessionId, active]);
  return progress;
}
