import { z } from 'zod';

/**
 * Google Calendar API v3 `events.list` (ADR-0013), verified against
 * developers.google.com/workspace/calendar/api/v3/reference/events/list and .../events on
 * 2026-11-18: `timeMin` bounds the event's end and `timeMax` its start (both exclusive),
 * `singleEvents=true` expands recurring events (each instance has its own `id`), `orderBy=startTime`
 * needs `singleEvents`, pages via `nextPageToken`. Attendee `displayName` is optional ("if
 * available"), so the email's name part stands in. Read-only: we never write to a calendar.
 */
export const CALENDAR_EVENTS_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TIMEOUT_MS = 10_000;
const MAX_PAGES = 5;
const MAX_ATTENDEES = 100;

export interface CalendarEventData {
  externalId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** abc-defg-hij, or null when the event has no Google Meet link. */
  meetCode: string | null;
  attendees: { name: string | null; email: string | null; self: boolean; organizer: boolean }[];
}

const GTime = z.object({ dateTime: z.string().optional(), date: z.string().optional() });
const GEvent = z.object({
  id: z.string().min(1).max(1024),
  status: z.string().optional(),
  summary: z.string().optional(),
  start: GTime.optional(),
  end: GTime.optional(),
  hangoutLink: z.string().optional(),
  conferenceData: z
    .object({
      conferenceId: z.string().optional(),
      conferenceSolution: z.object({ key: z.object({ type: z.string() }).optional() }).optional(),
      entryPoints: z
        .array(z.object({ entryPointType: z.string().optional(), uri: z.string().optional() }))
        .optional(),
    })
    .optional(),
  attendees: z
    .array(
      z.object({
        email: z.string().optional(),
        displayName: z.string().optional(),
        self: z.boolean().optional(),
        organizer: z.boolean().optional(),
        resource: z.boolean().optional(),
      }),
    )
    .optional(),
});
const GEventList = z.object({
  items: z.array(z.unknown()).default([]),
  nextPageToken: z.string().optional(),
});

const MEET_CODE = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|$)/;

/** The Meet code from the event's video entry point or Hangouts link; null for other tools. */
export function meetCodeOf(event: z.infer<typeof GEvent>): string | null {
  const uris = [
    ...(event.conferenceData?.entryPoints ?? [])
      .filter((e) => e.entryPointType === 'video')
      .map((e) => e.uri ?? ''),
    event.hangoutLink ?? '',
  ];
  for (const uri of uris) {
    const match = MEET_CODE.exec(uri);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/** One API item → what we store; null for cancelled, all-day or malformed events. */
export function toCalendarEvent(raw: unknown): CalendarEventData | null {
  const parsed = GEvent.safeParse(raw);
  if (!parsed.success) return null;
  const e = parsed.data;
  if (e.status === 'cancelled') return null;
  // All-day events (start.date) are not calls.
  const start = e.start?.dateTime;
  const end = e.end?.dateTime;
  if (start === undefined || end === undefined) return null;
  const startsAt = new Date(start);
  const endsAt = new Date(end);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  const attendees = (e.attendees ?? [])
    .filter((a) => a.resource !== true)
    .slice(0, MAX_ATTENDEES)
    .map((a) => ({
      name: a.displayName?.trim().slice(0, 200) || null,
      email: a.email?.trim().toLowerCase().slice(0, 320) || null,
      self: a.self === true,
      organizer: a.organizer === true,
    }));
  return {
    externalId: e.id,
    title: (e.summary ?? '').trim().slice(0, 200),
    startsAt,
    endsAt,
    meetCode: meetCodeOf(e),
    attendees,
  };
}

/** "neha.kapoor@acme.com" → "Neha Kapoor": a stand-in when the invite carries no name. */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local
    .split(/[._-]+/)
    .filter((p) => p !== '' && !/^\d+$/.test(p))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Personal mail domains say nothing about anyone's company. */
const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
  'aol.com',
  'zoho.com',
]);

/** "neha@acme-retail.co.in" → "Acme Retail"; null for personal mail and short names. */
export function companyFromEmail(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (domain === '' || PERSONAL_DOMAINS.has(domain)) return null;
  const labels = domain.split('.');
  // The label before the public suffix: acme.com, acme.co.in, mail.acme.com → acme.
  const suffixLength = labels.length >= 3 && (labels.at(-2) ?? '').length <= 3 ? 2 : 1;
  const label = labels.at(-(suffixLength + 1)) ?? '';
  if (label.length < 3) return null;
  return label
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export class CalendarHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`google calendar http ${status}`);
    this.name = 'CalendarHttpError';
    this.status = status;
  }
}

/** Events of the primary calendar that overlap [timeMin, timeMax), soonest first. */
export async function listCalendarEvents(
  accessToken: string,
  window: { timeMin: Date; timeMax: Date },
  deps: { fetch?: typeof fetch } = {},
): Promise<CalendarEventData[]> {
  const doFetch = deps.fetch ?? fetch;
  const events: CalendarEventData[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      timeMin: window.timeMin.toISOString(),
      timeMax: window.timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      eventTypes: 'default',
    });
    if (pageToken !== undefined) params.set('pageToken', pageToken);
    const response = await doFetch(`${CALENDAR_EVENTS_URL}?${params}`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new CalendarHttpError(response.status);
    const body = GEventList.parse(await response.json());
    for (const item of body.items) {
      const event = toCalendarEvent(item);
      if (event !== null) events.push(event);
    }
    pageToken = body.nextPageToken;
    if (pageToken === undefined) break;
  }
  return events;
}
