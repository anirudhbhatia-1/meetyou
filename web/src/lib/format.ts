/** Display helpers (DESIGN §10–§14). Times are tabular in CSS; these return plain strings. */

const DAY_MS = 24 * 60 * 60 * 1000;

/** DESIGN §10: morning before 12:00, afternoon before 17:00, else evening (user's time zone). */
export function greeting(now: Date, firstName: string): string {
  const hour = now.getHours();
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return `Good ${part}, ${firstName}`;
}

/** "Thursday, 6 November" */
export function longDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "Today 10:30", "Yesterday 16:05", "Mon 3 Nov", "3 Oct 2025" */
export function formatWhen(iso: string, now: Date): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = date.getTime();
  if (t >= startOfToday) return `Today ${time}`;
  if (t >= startOfToday - DAY_MS) return `Yesterday ${time}`;
  if (t >= startOfToday - 6 * DAY_MS) {
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Meeting length: "42 min", "1 h 05 min" */
export function formatLength(startIso: string, endIso: string | null): string {
  if (endIso === null) return '—';
  const minutes = Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** Session-clock time: "4:07", "1:02:30" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "Recording 5 days left" / "Recording deleted" (DESIGN §5.1). */
export function recordingLabel(expiresIso: string | null, now: Date): string | null {
  if (expiresIso === null) return null;
  const days = Math.ceil((Date.parse(expiresIso) - now.getTime()) / DAY_MS);
  if (days <= 0) return 'Recording deleted';
  return `Recording ${days} day${days === 1 ? '' : 's'} left`;
}

export const TEMPLATE_LABEL = {
  general: 'General',
  standup: 'Standup',
  client_call: 'Client call',
  interview: 'Interview',
  one_on_one: '1:1',
} as const;
export type TemplateId = keyof typeof TEMPLATE_LABEL;

/**
 * DESIGN §12.6: the resolved date when there is one ("Sun 8 Nov"); otherwise the phrase as said
 * ("this week").
 */
export function formatDue(item: { dueDate: string | null; duePhrase: string | null }): string {
  if (item.dueDate !== null) {
    const [y, m, d] = item.dueDate.split('-').map(Number);
    if (y !== undefined && m !== undefined && d !== undefined) {
      return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
    }
  }
  return item.duePhrase ?? 'No due date';
}

/** The meeting's name; Meet may not expose one (no title, or read before the call loaded). */
export function meetingTitle(meeting: { title: string }): string {
  return meeting.title.trim() === '' ? 'Untitled meeting' : meeting.title;
}

/** "1 person" / "3 people": the participants plus you. */
export function peopleLabel(others: number): string {
  const n = others + 1;
  return n === 1 ? '1 person' : `${n} people`;
}
