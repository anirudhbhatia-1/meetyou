/**
 * ADR-0013: the calendar consent comes back to `/calendar/callback`; App takes the code from the
 * URL there and leaves it here for Settings, which posts it once the API is ready.
 */
export interface PendingCalendarConnect {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

let pending: PendingCalendarConnect | 'failed' | null = null;

export function setPendingCalendarConnect(value: PendingCalendarConnect | 'failed'): void {
  pending = value;
}

/** Read once: a reload does not post the same code again. */
export function takePendingCalendarConnect(): PendingCalendarConnect | 'failed' | null {
  const value = pending;
  pending = null;
  return value;
}
