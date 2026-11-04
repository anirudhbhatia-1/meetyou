/**
 * Google Meet Metadata Extractor Module
 *
 * Extracts meeting title and active participant display names from the Meet UI.
 *
 * Requirements:
 * - FR-DET-04: Read meeting title and participant display names where available.
 * - PRD §13: No emails scraped in Phase 1.
 * - ARCHITECTURE §4.6: DOM text read from Meet is untrusted input.
 */

import { extractMeetingCode } from './detector.ts';
import { METADATA_SELECTORS, PARTICIPANT_SELECTORS, queryWithFallbacks } from './selectors.ts';

const MAX_TITLE_LENGTH = 200;
const MAX_NAME_LENGTH = 100;
const DEFAULT_TITLE = 'Untitled Meeting';

// Detects an email address anywhere in the text (PRD §13: no emails scraped in Phase 1). Not
// anchored: labels such as "Asha (asha@example.com)" must be rejected too.
const EMAIL_REGEX = /[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+/;

// Regex to extract name from Meet's 3-dot tile menu ("More options for <Name>")
const MORE_OPTIONS_REGEX = /(?:more_vert\s*)?More options for\s+([^,]+)/i;

// Regex to filter out Google Meet UI strings, settings, and icon labels
const UI_JUNK_REGEX =
  /(?:sound settings|visual_effects|more_vert|frame_person|reframe|effects|full video|microphone|camera|options for|backgrounds and effects)/i;

// Regex to match Meet self / status suffixes, e.g. "Gaurav (You)", "Alex (Presenting)"
const STATUS_SUFFIX_REGEX = /\s*\((?:you|presenting|presentation|external)\)/i;
const SELF_SUFFIX_REGEX = /\s*\(you\)/i;
const HTML_TAGS_REGEX = /<[^>]*>/g;

export interface ParticipantInfo {
  displayName: string;
  isSelf: boolean;
}

export interface MeetingMetadata {
  title: string;
  meetingCode: string | null;
  participants: ParticipantInfo[];
  extractedAt: number;
}

/**
 * Strips unprintable control characters without triggering ESLint no-control-regex.
 */
function stripControlCharacters(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Exclude ASCII control chars (< 32 except tab/newline), DEL (127), and C1 controls (128-159)
    if ((code >= 32 && code < 127) || code > 159 || code === 9 || code === 10 || code === 13) {
      result += text[i];
    }
  }
  return result;
}

/**
 * Sanitizes untrusted text read from the Meet DOM.
 * Strips HTML tags, control characters, excess whitespace, and caps max length.
 */
export function sanitizeUntrustedText(raw: string | null | undefined, maxLength = 200): string {
  if (raw === null || raw === undefined) {
    return '';
  }

  const noHtml = raw.replace(HTML_TAGS_REGEX, '');
  const noControls = stripControlCharacters(noHtml);
  return noControls.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * Extracts and sanitizes the meeting title from the Meet DOM.
 * Falls back to the meeting code or "Untitled Meeting".
 */
export function extractMeetingTitle(container: ParentNode, fallbackCode?: string | null): string {
  const match = queryWithFallbacks(container, METADATA_SELECTORS.meetingTitle);

  if (match.element !== null) {
    const rawText = match.element.textContent ?? '';
    const sanitized = sanitizeUntrustedText(rawText, MAX_TITLE_LENGTH);

    // If the element has valid text that is not merely the email address
    if (sanitized.length > 0 && !EMAIL_REGEX.test(sanitized)) {
      return sanitized;
    }
  }

  if (fallbackCode !== null && fallbackCode !== undefined && fallbackCode.trim().length > 0) {
    return fallbackCode.trim();
  }

  return DEFAULT_TITLE;
}

/**
 * Cleans a participant display name by removing status tags like "(You)" or "(Presenting)"
 * and verifying it does not contain raw emails or Meet UI icon labels.
 */
export function cleanParticipantName(
  rawName: string | null | undefined,
): { name: string; isSelf: boolean } | null {
  if (rawName === null || rawName === undefined) {
    return null;
  }

  // Handle "More options for <Name>" or "more_vertMore options for <Name>"
  const moreOptionsMatch = rawName.match(MORE_OPTIONS_REGEX);
  const targetText = moreOptionsMatch?.[1] !== undefined ? moreOptionsMatch[1] : rawName;

  const isSelf = SELF_SUFFIX_REGEX.test(targetText);
  const stripped = targetText.replace(STATUS_SUFFIX_REGEX, '');
  const sanitized = sanitizeUntrustedText(stripped, MAX_NAME_LENGTH);

  // Filter out empty names, single chars, email addresses, or Meet UI junk
  if (sanitized.length < 2 || EMAIL_REGEX.test(sanitized) || UI_JUNK_REGEX.test(sanitized)) {
    return null;
  }

  return { name: sanitized, isSelf };
}

/**
 * Extracts participant display names from the Meet DOM.
 * Probes both tile name labels and the participants list if open.
 */
export function extractParticipants(container: ParentNode): ParticipantInfo[] {
  const participantsMap = new Map<string, ParticipantInfo>();

  // Check if self-name is known from data-self-name element
  let selfName: string | null = null;
  try {
    const selfEl = container.querySelector('div[data-self-name]');
    if (selfEl !== null) {
      const val = selfEl.getAttribute('data-self-name') ?? selfEl.textContent;
      const cleaned = cleanParticipantName(val);
      if (cleaned !== null) {
        selfName = cleaned.name.toLowerCase();
        participantsMap.set(selfName, {
          displayName: cleaned.name,
          isSelf: true,
        });
      }
    }
  } catch {
    // Ignore query error
  }

  // 1. Probe video tile name labels & tile action buttons
  for (const selector of PARTICIPANT_SELECTORS.tileNameLabel.selectors) {
    try {
      const nodes = container.querySelectorAll(selector);
      for (const node of nodes) {
        const ariaLabel = node.getAttribute('aria-label');
        const selfAttr = node.getAttribute('data-self-name');
        const rawText = selfAttr ?? ariaLabel ?? node.textContent;
        const cleaned = cleanParticipantName(rawText);

        if (cleaned !== null) {
          const key = cleaned.name.toLowerCase();
          const existing = participantsMap.get(key);
          const isSelf =
            cleaned.isSelf ||
            selfAttr !== null ||
            (selfName !== null && key === selfName) ||
            (existing?.isSelf ?? false);

          participantsMap.set(key, {
            displayName: cleaned.name,
            isSelf,
          });
        }
      }
    } catch {
      // Ignore individual selector query errors
    }
  }

  // 2. Probe people panel if open
  for (const selector of PARTICIPANT_SELECTORS.peoplePanelList.selectors) {
    try {
      const nodes = container.querySelectorAll(selector);
      for (const node of nodes) {
        const ariaLabel = node.getAttribute('aria-label');
        const rawText = ariaLabel ?? node.textContent;
        const cleaned = cleanParticipantName(rawText);

        if (cleaned !== null) {
          const key = cleaned.name.toLowerCase();
          const existing = participantsMap.get(key);
          const isSelf =
            cleaned.isSelf ||
            (selfName !== null && key === selfName) ||
            (existing?.isSelf ?? false);

          participantsMap.set(key, {
            displayName: cleaned.name,
            isSelf,
          });
        }
      }
    } catch {
      // Ignore selector errors
    }
  }

  return Array.from(participantsMap.values());
}

/**
 * Convenience function to extract full metadata snapshot synchronously.
 */
export function extractMeetingMetadata(
  container: ParentNode,
  currentUrl?: string,
): MeetingMetadata {
  const meetingCode = extractMeetingCode(currentUrl);
  const title = extractMeetingTitle(container, meetingCode);
  const participants = extractParticipants(container);

  return {
    title,
    meetingCode,
    participants,
    extractedAt: Date.now(),
  };
}
