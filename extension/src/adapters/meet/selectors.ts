/**
 * Google Meet DOM Selectors Module
 *
 * Single source of truth for all Google Meet DOM selectors.
 * Each entry defines a primary selector with ordered fallbacks to withstand
 * Google Meet UI updates.
 *
 * Rule (ARCHITECTURE §4.6): All Meet DOM selectors live in this module with
 * fallbacks and version tags. DOM text read from Meet is untrusted input.
 */

export const MEET_SELECTORS_VERSION = '2026-11-03';

export interface SelectorDescriptor {
  readonly id: string;
  readonly description: string;
  readonly selectors: readonly string[];
  readonly required?: boolean;
}

export interface SelectorMatchResult {
  readonly element: Element | null;
  readonly matchedSelector: string | null;
  readonly isPrimary: boolean;
  readonly selectorIndex: number;
}

/**
 * Lobby / Pre-call Green Room Indicators
 * Used to ensure recording NEVER activates in the lobby.
 */
export const LOBBY_SELECTORS = {
  joinButton: {
    id: 'lobby.join-button',
    description: 'Join now or Ask to join button in pre-call screen',
    selectors: [
      'button[jsname="Qx7uuf"]',
      'button[aria-label*="Join now" i]',
      'button[aria-label*="Ask to join" i]',
      'button[data-idom-class*="join" i]',
    ],
  },
  readyHeading: {
    id: 'lobby.ready-heading',
    description: 'Ready to join heading in pre-call screen',
    selectors: ['[data-call-ready]', 'h2[jsname="r4nke"]', 'div[aria-label*="Ready to join" i]'],
    required: false,
  },
} as const satisfies Record<string, SelectorDescriptor>;

/**
 * In-Call Active Meeting Indicators
 * Used to detect when the user has entered the active call.
 */
export const IN_CALL_SELECTORS = {
  leaveCallButton: {
    id: 'in-call.leave-button',
    description: 'Red leave / end call button present only in active call',
    selectors: [
      'button[aria-label*="Leave call" i]',
      'button[jsname="CQylAd"]',
      'button[data-tooltip*="Leave call" i]',
      'button[aria-label*="leave" i]',
    ],
  },
  controlBar: {
    id: 'in-call.control-bar',
    description: 'Bottom media control bar in active call',
    selectors: [
      'div[role="region"][aria-label*="Call controls" i]',
      'div[jscontroller="kAPstf"]',
      'div[data-is-muted]',
    ],
  },
  micButton: {
    id: 'in-call.mic-button',
    description: 'Microphone mute/unmute button in active call',
    selectors: [
      'button[aria-label*="Turn off microphone" i]',
      'button[aria-label*="Turn on microphone" i]',
      'button[jsname="B1qRre"]',
      'button[data-is-muted]',
    ],
  },
} as const satisfies Record<string, SelectorDescriptor>;

/**
 * Call Ended / Post-call Indicators
 */
export const CALL_ENDED_SELECTORS = {
  rejoinButton: {
    id: 'call-ended.rejoin-button',
    description: 'Rejoin button shown after call has ended',
    selectors: ['button[aria-label*="Rejoin" i]', 'a[aria-label*="Rejoin" i]'],
    required: false,
  },
  returnHomeButton: {
    id: 'call-ended.return-home',
    description: 'Return to home screen button',
    selectors: [
      'button[aria-label*="Return to home screen" i]',
      'a[aria-label*="Return to home screen" i]',
      'a[href="/"]',
    ],
  },
} as const satisfies Record<string, SelectorDescriptor>;

/**
 * Meeting Metadata Indicators (Title & Code)
 */
export const METADATA_SELECTORS = {
  meetingTitle: {
    id: 'metadata.title',
    description: 'Meeting title or subject element',
    selectors: [
      'div[data-meeting-title]',
      'div[jsname="r4nke"]',
      'div[data-call-title]',
      'h1[jsname="r4nke"]',
    ],
    required: false,
  },
  meetingDetailsButton: {
    id: 'metadata.details-button',
    description: 'Meeting details trigger button (shows meeting link/code)',
    selectors: ['button[aria-label*="Meeting details" i]', 'button[jsname="r8qRAd"]'],
    required: false,
  },
} as const satisfies Record<string, SelectorDescriptor>;

/**
 * Participant Name Indicators
 */
export const PARTICIPANT_SELECTORS = {
  tileNameLabel: {
    id: 'participants.tile-name',
    description: 'Participant name label on video tiles',
    selectors: [
      'button[aria-label*="More options for " i]',
      'div[data-self-name]',
      'div[data-participant-id] [data-self-name]',
      'div[data-participant-id] div[aria-label]',
    ],
  },
  peoplePanelList: {
    id: 'participants.people-list',
    description: 'Participant entries in the People sidebar tab',
    selectors: [
      'div[role="list"][aria-label*="Participants" i] [role="listitem"]',
      'div[role="tabpanel"][aria-label*="People" i] [role="listitem"]',
    ],
    required: false,
  },
} as const satisfies Record<string, SelectorDescriptor>;

/**
 * Evaluates a selector descriptor against a container (document or element).
 * Returns the matched element and telemetry regarding whether primary or a fallback matched.
 */
export function queryWithFallbacks(
  container: ParentNode,
  descriptor: SelectorDescriptor,
): SelectorMatchResult {
  for (let i = 0; i < descriptor.selectors.length; i++) {
    const selector = descriptor.selectors[i];
    if (selector === undefined) {
      continue;
    }
    try {
      const element = container.querySelector(selector);
      if (element !== null) {
        return {
          element,
          matchedSelector: selector,
          isPrimary: i === 0,
          selectorIndex: i,
        };
      }
    } catch {
      // Ignore querySelector syntax errors if any vendor pseudo-selector fails
      continue;
    }
  }

  return {
    element: null,
    matchedSelector: null,
    isPrimary: false,
    selectorIndex: -1,
  };
}

/**
 * Checks if at least one selector in the descriptor matches.
 */
export function matchesAny(container: ParentNode, descriptor: SelectorDescriptor): boolean {
  return queryWithFallbacks(container, descriptor).element !== null;
}
