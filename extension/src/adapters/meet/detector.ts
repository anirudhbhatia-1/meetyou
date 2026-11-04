/**
 * Google Meet Call State Detector Module
 *
 * Detects whether the user is on home, in lobby (green room), in an active call,
 * or has ended the call.
 *
 * Requirements:
 * - FR-DET-01: Detect in-call state within 5s; NEVER trigger in lobby.
 * - FR-DET-05: Detect meeting end.
 * - ARCHITECTURE §4.6: URL + in-call controls -> state.
 */

import {
  CALL_ENDED_BUTTON_TEXT,
  CALL_ENDED_SELECTORS,
  findButtonByText,
  IN_CALL_SELECTORS,
  LOBBY_SELECTORS,
  queryWithFallbacks,
} from './selectors.ts';

export type MeetCallState = 'not_meet' | 'home' | 'lobby' | 'in_call' | 'ended';

export interface MeetStateSnapshot {
  readonly state: MeetCallState;
  readonly meetingCode: string | null;
  readonly matchedSelector: string | null;
  readonly timestamp: number;
}

const MEET_HOST = 'meet.google.com';
const MEETING_CODE_REGEX = /[a-z]{3}-[a-z]{4}-[a-z]{3}/i;

/**
 * Extracts a Google Meet meeting code (e.g. "abc-defg-hij") from a URL.
 */
export function extractMeetingCode(url: string | undefined): string | null {
  if (url === undefined || url === '') {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(MEET_HOST)) {
      return null;
    }
    const match = parsed.pathname.match(MEETING_CODE_REGEX);
    return match ? match[0].toLowerCase() : null;
  } catch {
    const match = url.match(MEETING_CODE_REGEX);
    return match ? match[0].toLowerCase() : null;
  }
}

/**
 * Probes the DOM and URL to determine the current meeting state synchronously.
 */
export function detectCallState(
  container: ParentNode,
  currentUrl: string | undefined = typeof window !== 'undefined' ? window.location.href : undefined,
): MeetStateSnapshot {
  const timestamp = Date.now();
  const meetingCode = extractMeetingCode(currentUrl);

  // Check if URL is not a Google Meet domain
  if (currentUrl !== undefined && currentUrl !== '') {
    try {
      const parsed = new URL(currentUrl);
      if (!parsed.hostname.endsWith(MEET_HOST)) {
        return { state: 'not_meet', meetingCode: null, matchedSelector: null, timestamp };
      }
    } catch {
      // If parsing fails, continue with fallback inspection
    }
  }

  // 1. The Leave call button wins over ended signals: an ended state stops recording, and broad
  // fallbacks such as `a[href="/"]` can match on the in-call page too.
  const leaveMatch = queryWithFallbacks(container, IN_CALL_SELECTORS.leaveCallButton);
  if (leaveMatch.element !== null) {
    return {
      state: 'in_call',
      meetingCode,
      matchedSelector: leaveMatch.matchedSelector,
      timestamp,
    };
  }

  // 2. Check if Call Ended (rejoin button, return to home button)
  const rejoinMatch = queryWithFallbacks(container, CALL_ENDED_SELECTORS.rejoinButton);
  if (rejoinMatch.element !== null) {
    return {
      state: 'ended',
      meetingCode,
      matchedSelector: rejoinMatch.matchedSelector,
      timestamp,
    };
  }

  const returnHomeMatch = queryWithFallbacks(container, CALL_ENDED_SELECTORS.returnHomeButton);
  if (returnHomeMatch.element !== null && meetingCode !== null) {
    return {
      state: 'ended',
      meetingCode,
      matchedSelector: returnHomeMatch.matchedSelector,
      timestamp,
    };
  }

  // Same screen recognised by button text when its buttons have no aria-label.
  const endedButton = findButtonByText(container, CALL_ENDED_BUTTON_TEXT);
  if (endedButton !== null && meetingCode !== null) {
    return {
      state: 'ended',
      meetingCode,
      matchedSelector: `text:${endedButton.textContent?.trim().toLowerCase() ?? ''}`,
      timestamp,
    };
  }

  // 3. Check if Lobby / Green Room (Join button or Ready heading)
  const joinMatch = queryWithFallbacks(container, LOBBY_SELECTORS.joinButton);
  if (joinMatch.element !== null) {
    return {
      state: 'lobby',
      meetingCode,
      matchedSelector: joinMatch.matchedSelector,
      timestamp,
    };
  }

  const readyMatch = queryWithFallbacks(container, LOBBY_SELECTORS.readyHeading);
  if (readyMatch.element !== null) {
    return {
      state: 'lobby',
      meetingCode,
      matchedSelector: readyMatch.matchedSelector,
      timestamp,
    };
  }

  // The control bar is a weaker in-call signal: its `data-is-muted` fallback also exists on the
  // pre-call mic toggle, so lobby elements are checked first (FR-DET-01: never in lobby).
  const controlBarMatch = queryWithFallbacks(container, IN_CALL_SELECTORS.controlBar);
  if (controlBarMatch.element !== null && meetingCode !== null) {
    return {
      state: 'in_call',
      meetingCode,
      matchedSelector: controlBarMatch.matchedSelector,
      timestamp,
    };
  }

  // 4. If URL has a meeting code but in-call buttons haven't appeared,
  // classify as lobby (safe default: NEVER trigger in lobby)
  if (meetingCode !== null) {
    return {
      state: 'lobby',
      meetingCode,
      matchedSelector: null,
      timestamp,
    };
  }

  // 5. Otherwise, we are on the Meet landing/home page
  return {
    state: 'home',
    meetingCode: null,
    matchedSelector: null,
    timestamp,
  };
}

export interface ObserverOptions {
  readonly debounceMs?: number;
  readonly getUrl?: () => string | undefined;
}

/**
 * Observes DOM mutations and URL changes to notify when the meeting call state transitions.
 * Returns an unobserve/cleanup function.
 */
export function observeCallState(
  container: Node & ParentNode,
  onChange: (snapshot: MeetStateSnapshot, previousState: MeetCallState) => void,
  options: ObserverOptions = {},
): () => void {
  const debounceMs = options.debounceMs ?? 150;
  const getUrl =
    options.getUrl ?? (() => (typeof window !== 'undefined' ? window.location.href : undefined));

  let lastState: MeetCallState = 'not_meet';
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let observer: MutationObserver | null = null;

  function evaluate() {
    const currentUrl = getUrl();
    const snapshot = detectCallState(container, currentUrl);

    if (snapshot.state !== lastState) {
      const prev = lastState;
      lastState = snapshot.state;
      onChange(snapshot, prev);
    }
  }

  // Immediate initial check
  evaluate();

  // Watch DOM mutations if MutationObserver is supported
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        timeoutId = null;
        evaluate();
      }, debounceMs);
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'jsname', 'data-is-muted', 'data-call-ready'],
    });
  }

  return function cleanup() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (observer !== null) {
      observer.disconnect();
      observer = null;
    }
  };
}
