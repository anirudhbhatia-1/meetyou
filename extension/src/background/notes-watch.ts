/**
 * "Notes ready: {title}" (DESIGN §8.7, J3, O1): after Stop the service worker follows the meeting
 * on the API with an alarm (it may sleep between checks) and notifies once its notes settle, unless
 * the side panel is open to show Ready itself.
 */
export const NOTES_ALARM = 'notes-ready';
export const NOTES_WATCH_KEY = 'notes.watch';
/** Checks stop after this long; the panel and the library still show the result. */
export const NOTES_WATCH_MS = 30 * 60_000;
/** Chrome's shortest alarm period (Chrome 120+; older versions round it up to a minute). */
export const NOTES_CHECK_MINUTES = 0.5;

export interface NotesWatch {
  meetingId: string;
  since: number;
}

export function parseNotesWatch(value: unknown): NotesWatch | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  return typeof v.meetingId === 'string' && v.meetingId !== '' && typeof v.since === 'number'
    ? { meetingId: v.meetingId, since: v.since }
    : null;
}

const TITLE_MAX = 80;

function shortTitle(title: string): string {
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

/** The notification for a settled meeting, or null while its notes are still being written. */
export function notesNotice(
  status: string,
  title: string,
): { title: string; message: string } | null {
  const name = shortTitle(title);
  switch (status) {
    case 'ready':
    case 'updated':
      return { title: `Notes ready: ${name}`, message: 'Click to open them in your library.' };
    case 'too_short':
      return {
        title: `Too short for notes: ${name}`,
        message: 'The transcript is saved. Click to open it.',
      };
    case 'failed':
      return {
        title: `We couldn’t write notes: ${name}`,
        message: 'The transcript is saved. Click to try again from the meeting.',
      };
    default:
      return null;
  }
}

/** Notification IDs carry the meeting, so a click opens the right one. */
export function notesNotificationId(meetingId: string): string {
  return `notes:${meetingId}`;
}

export function meetingFromNotificationId(id: string): string | null {
  return id.startsWith('notes:') && id.length > 'notes:'.length ? id.slice('notes:'.length) : null;
}
