/**
 * Google Meet Active-Speaker Signal Module (S1-08)
 *
 * Observes visual active-speaker cues in Google Meet's DOM (speaking waves, volume
 * indicators, and tile outlines) to attribute speaker turns (PRD FR-SPK-03).
 *
 * Requirements:
 * - FR-SPK-03: Map clusters to participant names using Meet active-speaker signals (DOM).
 * - ARCHITECTURE §4.6: DOM text read from Meet is untrusted input.
 * - AGENTS §7: Logs must not contain participant names or emails; log IDs and counts only.
 */

import { cleanParticipantName } from './metadata.ts';
import { PARTICIPANT_SELECTORS, SPEAKER_SELECTORS, type SelectorDescriptor } from './selectors.ts';

export interface ActiveSpeakerInfo {
  readonly participantId: string;
  readonly displayName?: string;
  readonly isSelf: boolean;
}

export interface ActiveSpeakerEvent {
  readonly speaker: ActiveSpeakerInfo;
  readonly at: number;
}

export interface ActiveSpeakerObserverOptions {
  readonly throttleMs?: number;
  readonly silenceResetMs?: number;
}

/**
 * Searches up the DOM tree from an element to find its parent participant tile.
 */
function findParentParticipantTile(
  element: Element,
  tileDescriptor: SelectorDescriptor = SPEAKER_SELECTORS.participantTile,
): Element | null {
  for (const selector of tileDescriptor.selectors) {
    try {
      const match = element.closest(selector);
      if (match !== null) return match;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Extracts participant identity from a video tile element.
 */
function extractTileIdentity(tile: Element): ActiveSpeakerInfo | null {
  // 1. Direct ID attributes from Meet DOM
  const participantId =
    tile.getAttribute('data-participant-id') ??
    tile.getAttribute('data-requested-participant-id') ??
    tile.getAttribute('data-allocation-id');

  // Check self indicator
  const hasSelfAttr =
    tile.getAttribute('data-self-name') !== null ||
    tile.querySelector('div[data-self-name]') !== null;

  // 2. Extract display name from tile label buttons or text
  let displayName: string | undefined;
  let isSelf = hasSelfAttr;

  for (const selector of PARTICIPANT_SELECTORS.tileNameLabel.selectors) {
    try {
      const labelEl = tile.querySelector(selector);
      if (labelEl !== null) {
        const raw =
          labelEl.getAttribute('data-self-name') ??
          labelEl.getAttribute('aria-label') ??
          labelEl.textContent;
        const cleaned = cleanParticipantName(raw);
        if (cleaned !== null) {
          displayName = cleaned.name;
          if (cleaned.isSelf) {
            isSelf = true;
          }
          break;
        }
      }
    } catch {
      continue;
    }
  }

  // If no participantId attribute exists, synthesize a deterministic ID from display name
  const resolvedId =
    participantId !== null
      ? participantId
      : displayName !== undefined
        ? `p_${displayName.toLowerCase().replace(/\s+/g, '_')}`
        : null;

  if (resolvedId === null) {
    return null;
  }

  return {
    participantId: resolvedId,
    displayName,
    isSelf,
  };
}

/**
 * Detects currently active speakers in the Google Meet DOM.
 * Returns an array of active speaker records.
 */
export function detectActiveSpeakers(container: ParentNode): ActiveSpeakerInfo[] {
  const speakers: ActiveSpeakerInfo[] = [];
  const seenIds = new Set<string>();

  for (const selector of SPEAKER_SELECTORS.speakingIndicator.selectors) {
    try {
      const elements = container.querySelectorAll(selector);
      for (const el of elements) {
        // If element is explicitly marked as not speaking, skip
        if (el.getAttribute('data-is-speaking') === 'false') {
          continue;
        }

        const tile = findParentParticipantTile(el);
        const identity = tile !== null ? extractTileIdentity(tile) : extractTileIdentity(el);

        if (identity !== null && !seenIds.has(identity.participantId)) {
          seenIds.add(identity.participantId);
          speakers.push(identity);
        }
      }
    } catch {
      continue;
    }
  }

  return speakers;
}

/**
 * Observes active-speaker changes in the Google Meet DOM.
 * Throttles rapid animation mutations and notifies whenever an active speaker begins talking.
 *
 * Returns a teardown function to disconnect the observer.
 */
export function observeActiveSpeakers(
  container: Document,
  onSpeakerActive: (event: ActiveSpeakerEvent) => void,
  options: ActiveSpeakerObserverOptions = {},
): () => void {
  const throttleMs = options.throttleMs ?? 200;
  const silenceResetMs = options.silenceResetMs ?? 1500;

  let lastSpeakerId: string | null = null;
  let lastActiveTimestamp = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let isEvaluating = false;

  function evaluate(): void {
    isEvaluating = false;
    const now = Date.now();
    const activeSpeakers = detectActiveSpeakers(container);

    if (activeSpeakers.length > 0) {
      const primarySpeaker = activeSpeakers[0];
      if (primarySpeaker === undefined) return;

      const isDifferentSpeaker = primarySpeaker.participantId !== lastSpeakerId;
      const isPastSilenceInterval = now - lastActiveTimestamp > silenceResetMs;

      if (isDifferentSpeaker || isPastSilenceInterval) {
        lastSpeakerId = primarySpeaker.participantId;
        lastActiveTimestamp = now;

        onSpeakerActive({
          speaker: primarySpeaker,
          at: now,
        });
      } else {
        // Keep timestamp updated for ongoing speech
        lastActiveTimestamp = now;
      }
    } else {
      // If silence has persisted past reset interval, clear current speaker
      if (lastSpeakerId !== null && now - lastActiveTimestamp > silenceResetMs) {
        lastSpeakerId = null;
      }
    }
  }

  function scheduleEvaluation(): void {
    if (isEvaluating) return;
    isEvaluating = true;

    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(evaluate, throttleMs);
  }

  // Initial evaluation
  evaluate();

  if (typeof MutationObserver === 'undefined') {
    return () => {
      if (timerId !== null) clearTimeout(timerId);
    };
  }

  const observer = new MutationObserver(() => {
    scheduleEvaluation();
  });

  const target = container.body ?? container.documentElement ?? container;
  try {
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-is-speaking', 'data-active-speaker', 'data-tile-speaker', 'class'],
    });
  } catch {
    // Graceful fallback if target observation fails
  }

  return () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    observer.disconnect();
  };
}
