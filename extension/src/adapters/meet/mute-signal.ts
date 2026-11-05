/**
 * Google Meet Mute Signal Module (S1-08)
 *
 * Observes the user's local microphone mute/unmute state from Google Meet's DOM.
 * Emits `mic.mute_changed` events used for `me`-lane gating (PRD FR-CAP-11).
 *
 * Requirements:
 * - FR-CAP-11: Respect Meet's own mute; pause me-lane audio or tag frames when muted.
 * - ARCHITECTURE §4.6: DOM text read from Meet is untrusted input.
 */

import { IN_CALL_SELECTORS, queryWithFallbacks } from './selectors.ts';

export interface MuteStateSnapshot {
  readonly isMuted: boolean | null;
  readonly matchedBy: string | null;
}

export interface MuteChangeEvent {
  readonly muted: boolean;
  readonly at: number;
}

const UNMUTE_REGEX = /(?:turn on microphone|unmute)/i;
const MUTE_REGEX = /(?:turn off microphone|mute)/i;

/**
 * Detects whether the user's microphone is muted in Google Meet.
 * Returns null if the microphone button cannot be found in the DOM.
 */
export function detectMuteState(container: ParentNode): MuteStateSnapshot {
  const match = queryWithFallbacks(container, IN_CALL_SELECTORS.micButton);
  if (match.element === null) {
    return { isMuted: null, matchedBy: null };
  }

  const el = match.element;

  // 1. Primary indicator: data-is-muted attribute
  const dataIsMuted = el.getAttribute('data-is-muted');
  if (dataIsMuted === 'true') {
    return { isMuted: true, matchedBy: 'data-is-muted=true' };
  }
  if (dataIsMuted === 'false') {
    return { isMuted: false, matchedBy: 'data-is-muted=false' };
  }

  // 2. Fallback indicator: aria-label
  const ariaLabel = el.getAttribute('aria-label') ?? '';
  if (UNMUTE_REGEX.test(ariaLabel)) {
    // If the label invites turning ON the mic, it is currently MUTED.
    return { isMuted: true, matchedBy: 'aria-label(unmute)' };
  }
  if (MUTE_REGEX.test(ariaLabel)) {
    // If the label invites turning OFF the mic, it is currently UNMUTED.
    return { isMuted: false, matchedBy: 'aria-label(mute)' };
  }

  // 3. Fallback indicator: aria-pressed
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed === 'true') {
    return { isMuted: true, matchedBy: 'aria-pressed=true' };
  }
  if (ariaPressed === 'false') {
    return { isMuted: false, matchedBy: 'aria-pressed=false' };
  }

  return { isMuted: null, matchedBy: null };
}

/**
 * Observes the user's microphone mute state in Google Meet.
 * Triggers `onMuteChange` whenever the mute state transitions (e.g. unmuted -> muted).
 *
 * Returns a teardown function to disconnect the observer.
 */
export function observeMuteState(
  container: Document,
  onMuteChange: (event: MuteChangeEvent) => void,
): () => void {
  let prevMuted: boolean | null = null;

  function evaluate(): void {
    const { isMuted } = detectMuteState(container);
    if (isMuted === null) return;

    if (prevMuted !== isMuted) {
      prevMuted = isMuted;
      onMuteChange({
        muted: isMuted,
        at: Date.now(),
      });
    }
  }

  // Evaluate initial mute state immediately
  evaluate();

  // If MutationObserver is unavailable (e.g. in non-DOM tests), return no-op
  if (typeof MutationObserver === 'undefined') {
    return () => undefined;
  }

  const observer = new MutationObserver(() => {
    evaluate();
  });

  const target = container.body ?? container.documentElement ?? container;
  try {
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-is-muted', 'aria-label', 'aria-pressed', 'class'],
    });
  } catch {
    // Graceful fallback if target observation fails
  }

  return () => {
    observer.disconnect();
  };
}

