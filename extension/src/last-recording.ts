/**
 * The newest recording, kept after the panel returns to Ready so its video can still be played or
 * downloaded. TODO(S4-17, S2-14): the meeting page in the library web app replaces this, with the
 * finalized MP4 in its player.
 */
export const LAST_RECORDING_KEY = 'lastRecording';

export interface LastRecording {
  sessionId: string;
  startedAt: number;
}

export function parseLastRecording(value: unknown): LastRecording | null {
  if (typeof value !== 'object' || value === null) return null;
  const { sessionId, startedAt } = value as Record<string, unknown>;
  if (typeof sessionId !== 'string' || sessionId === '' || typeof startedAt !== 'number') {
    return null;
  }
  return { sessionId, startedAt };
}
