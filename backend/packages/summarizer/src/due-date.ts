/**
 * Relative due dates (ARCHITECTURE §10.2 step 5, S3-02): the model keeps the spoken words in
 * `due_phrase`; code turns them into a calendar date against the meeting's local date. Only
 * unambiguous phrases resolve — "next Friday" (this week's or next week's?) stays unresolved and
 * the UI shows the words. English and common Hinglish forms.
 */

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  ravivar: 0,
  itvaar: 0,
  monday: 1,
  mon: 1,
  somvar: 1,
  somvaar: 1,
  tuesday: 2,
  tue: 2,
  mangalvar: 2,
  mangalvaar: 2,
  wednesday: 3,
  wed: 3,
  budhvar: 3,
  budhvaar: 3,
  thursday: 4,
  thu: 4,
  guruvar: 4,
  guruvaar: 4,
  brihaspativar: 4,
  friday: 5,
  fri: 5,
  shukravar: 5,
  shukravaar: 5,
  saturday: 6,
  sat: 6,
  shanivar: 6,
  shanivaar: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD, or null. */
export function validIsoDate(value: string | null): string | null {
  if (value === null || !ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

function parse(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** The first `weekday` strictly after `date` ("Friday tak" said on a Friday means next week's). */
function nextWeekday(date: string, weekday: number): string {
  const from = parse(date).getUTCDay();
  const ahead = (weekday - from + 7) % 7 || 7;
  return addDays(date, ahead);
}

/** Day/month without a year: this year, or next year when that day has already passed. */
function dayMonth(date: string, day: number, month: number): string | null {
  const meeting = parse(date);
  for (const year of [meeting.getUTCFullYear(), meeting.getUTCFullYear() + 1]) {
    const candidate = new Date(Date.UTC(year, month, day));
    if (candidate.getUTCMonth() !== month) return null; // 31 Feb and the like
    if (iso(candidate) >= date) return iso(candidate);
  }
  return null;
}

/**
 * Resolves a spoken deadline against the meeting's local date (YYYY-MM-DD). Null when the phrase
 * is unknown or ambiguous: the item then shows its `due_phrase` without a date.
 */
export function resolveDuePhrase(phrase: string | null, meetingDate: string): string | null {
  if (phrase === null || validIsoDate(meetingDate) === null) return null;
  const p = phrase
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (p === '') return null;
  // Ambiguous by nature: never guessed.
  if (/\b(next|agle|agla|agli|coming|aane wale)\s+\w+/.test(p) && !/\bnext week\b/.test(p)) {
    return null;
  }
  if (/\b(today|aaj|eod|end of (the )?day|tonight|aaj raat)\b/.test(p)) return meetingDate;
  if (/\b(day after tomorrow|parso|parson)\b/.test(p)) return addDays(meetingDate, 2);
  if (/\b(tomorrow|kal|tmrw|tmr)\b/.test(p)) return addDays(meetingDate, 1);
  const inDays =
    /\b(?:in|within)\s+(\d{1,2})\s+days?\b|\b(\d{1,2})\s+din\s+(?:mein|me|main)\b/.exec(p);
  if (inDays !== null) return addDays(meetingDate, Number(inDays[1] ?? inDays[2]));
  if (/\b(end of (the |this )?month|month end|mahine ke (end|aakhir))\b/.test(p)) {
    const d = parse(meetingDate);
    return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  }
  if (/\b(end of (the |this )?week|this week|week end|is hafte|hafte ke end)\b/.test(p)) {
    return parse(meetingDate).getUTCDay() === 5 ? meetingDate : nextWeekday(meetingDate, 5);
  }
  // "15 Nov", "15th November", "Nov 15", "15/11" (day first, as written in India).
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b/.exec(p);
  if (dm !== null && MONTHS[dm[2] ?? ''] !== undefined) {
    return dayMonth(meetingDate, Number(dm[1]), MONTHS[dm[2] ?? ''] ?? 0);
  }
  const md = /\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(p);
  if (md !== null && MONTHS[md[1] ?? ''] !== undefined) {
    return dayMonth(meetingDate, Number(md[2]), MONTHS[md[1] ?? ''] ?? 0);
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})\b/.exec(p);
  if (slash !== null) return dayMonth(meetingDate, Number(slash[1]), Number(slash[2]) - 1);
  for (const word of p.split(' ')) {
    const weekday = WEEKDAYS[word];
    if (weekday !== undefined) return nextWeekday(meetingDate, weekday);
  }
  return null;
}
