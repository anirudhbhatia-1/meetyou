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

export const MEET_SELECTORS_VERSION = '2026-11-09';

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
    // Gone while waiting to be admitted after "Ask to join", so its absence is not a breakage.
    required: false,
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
    // No `div[data-is-muted]` fallback: the pre-call mic toggle carries it too, so a user waiting
    // to be admitted would read as in_call (FR-DET-01: never in the lobby).
    selectors: ['div[role="region"][aria-label*="Call controls" i]', 'div[jscontroller="kAPstf"]'],
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
    // No `a[href="/"]` fallback: that link is on the in-call page too, and `ended` stops recording
    // after 3 s whenever the Leave button is not found.
    selectors: [
      'button[aria-label*="Return to home screen" i]',
      'a[aria-label*="Return to home screen" i]',
    ],
  },
} as const satisfies Record<string, SelectorDescriptor>;

/**
 * Visible text of the post-call buttons. On the "You left the meeting" screen these buttons may
 * carry no aria-label, so the selectors above miss them (seen 2026-11-04). English UI only;
 * other languages are S1-12.
 */
export const CALL_ENDED_BUTTON_TEXT = ['rejoin', 'return to home screen'] as const;

/** First button-like element whose whole visible text equals one of `texts` (case-insensitive). */
export function findButtonByText(container: ParentNode, texts: readonly string[]): Element | null {
  for (const element of container.querySelectorAll('button, [role="button"]')) {
    const text = element.textContent?.replace(/\s+/g, ' ').trim().toLowerCase();
    if (text !== undefined && texts.includes(text)) return element;
  }
  return null;
}

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
 * Active Speaker Indicators (S1-08)
 * Used to detect which participant is actively talking.
 */
export const SPEAKER_SELECTORS = {
  speakingIndicator: {
    id: 'speaker.active-indicator',
    description: 'Visual speaking wave or volume meter indicator on a participant tile',
    selectors: [
      'div[data-is-speaking="true"]',
      'div[jsname="x3Eknd"]',
      'div[data-active-speaker="true"]',
      'div[aria-label*="speaking" i]',
      'div[data-tile-speaker="true"]',
    ],
    required: false,
  },
  participantTile: {
    id: 'speaker.participant-tile',
    description: 'Video or avatar tile container for an individual participant',
    selectors: [
      'div[data-participant-id]',
      'div[data-requested-participant-id]',
      'div[jscontroller="e6S21b"]',
      'div[data-allocation-id]',
    ],
    required: false,
  },
} as const satisfies Record<string, SelectorDescriptor>;

/**
 * Meet chat, for the consent notice (S4-07, DESIGN §8.5, FR-CON-01..02). [Verify] on a real call:
 * the chat panel's button, message box and send button change with Meet releases; a miss falls
 * back to "Couldn't post — copy this message" (never a silent failure).
 */
export const CHAT_SELECTORS = {
  openButton: {
    id: 'chat.open-button',
    description: 'Toolbar button that opens the "In-call messages" panel',
    selectors: [
      'button[aria-label*="Chat with everyone" i]',
      'button[aria-label*="Open chat" i]',
      'button[aria-label*="in-call messages" i]',
      'button[data-panel-id="2"]',
    ],
    required: false,
  },
  input: {
    id: 'chat.input',
    description: 'Message box of the chat panel',
    selectors: [
      'textarea[aria-label*="Send a message" i]',
      'textarea[placeholder*="Send a message" i]',
      'textarea[aria-label*="message" i]',
      'div[contenteditable="true"][aria-label*="message" i]',
    ],
    required: false,
  },
  sendButton: {
    id: 'chat.send-button',
    description: 'Send button next to the chat message box',
    selectors: [
      'button[aria-label*="Send a message" i]',
      'button[aria-label="Send" i]',
      'button[aria-label*="send" i][type="button"]',
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
