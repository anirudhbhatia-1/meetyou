import { describe, expect, it } from 'vitest';

import {
  CalendarHttpError,
  companyFromEmail,
  listCalendarEvents,
  nameFromEmail,
  toCalendarEvent,
} from './google-calendar.ts';

const event = (over: Record<string, unknown> = {}) => ({
  id: 'evt1_20261118T043000Z',
  status: 'confirmed',
  summary: 'Acme weekly',
  start: { dateTime: '2026-11-18T10:00:00+05:30' },
  end: { dateTime: '2026-11-18T10:30:00+05:30' },
  conferenceData: {
    conferenceSolution: { key: { type: 'hangoutsMeet' } },
    entryPoints: [
      { entryPointType: 'phone', uri: 'tel:+91-000' },
      { entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' },
    ],
  },
  attendees: [
    { email: 'asha@example.com', self: true, organizer: true },
    { email: 'neha.kapoor@acme.com', displayName: 'Neha Kapoor' },
    { email: 'room-4@resource.calendar.google.com', resource: true },
  ],
  ...over,
});

describe('toCalendarEvent', () => {
  it('keeps title, times, the Meet code and people, without meeting rooms', () => {
    const e = toCalendarEvent(event());
    expect(e).toMatchObject({
      externalId: 'evt1_20261118T043000Z',
      title: 'Acme weekly',
      meetCode: 'abc-defg-hij',
      attendees: [
        { name: null, email: 'asha@example.com', self: true, organizer: true },
        { name: 'Neha Kapoor', email: 'neha.kapoor@acme.com', self: false, organizer: false },
      ],
    });
    expect(e?.startsAt.toISOString()).toBe('2026-11-18T04:30:00.000Z');
  });

  it('reads the Hangouts link, and has no code for other tools', () => {
    expect(
      toCalendarEvent(
        event({ conferenceData: undefined, hangoutLink: 'https://meet.google.com/xyz-abcd-efg' }),
      )?.meetCode,
    ).toBe('xyz-abcd-efg');
    expect(
      toCalendarEvent(
        event({
          conferenceData: {
            entryPoints: [{ entryPointType: 'video', uri: 'https://zoom.us/j/1' }],
          },
        }),
      )?.meetCode,
    ).toBeNull();
  });

  it('drops cancelled, all-day and malformed events', () => {
    expect(toCalendarEvent(event({ status: 'cancelled' }))).toBeNull();
    expect(
      toCalendarEvent(event({ start: { date: '2026-11-18' }, end: { date: '2026-11-19' } })),
    ).toBeNull();
    expect(toCalendarEvent({ nope: true })).toBeNull();
  });
});

describe('names and companies from emails', () => {
  it('makes a readable name and a company, not for personal mail', () => {
    expect(nameFromEmail('neha.kapoor@acme.com')).toBe('Neha Kapoor');
    expect(nameFromEmail('rohan_2024@gmail.com')).toBe('Rohan');
    expect(companyFromEmail('neha@acme-retail.co.in')).toBe('Acme Retail');
    expect(companyFromEmail('neha@mail.razorpay.com')).toBe('Razorpay');
    expect(companyFromEmail('rohan@gmail.com')).toBeNull();
  });
});

describe('listCalendarEvents', () => {
  it('asks for one window of single events and follows pages', async () => {
    const urls: URL[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(new URL(String(url)));
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ya29');
      const second = urls.length === 2;
      return new Response(
        JSON.stringify(
          second
            ? { items: [event({ id: 'evt2' })] }
            : { items: [event(), { id: 'bad' }], nextPageToken: 'p2' },
        ),
      );
    }) as typeof fetch;
    const events = await listCalendarEvents(
      'ya29',
      { timeMin: new Date('2026-11-17T00:00:00Z'), timeMax: new Date('2026-11-20T00:00:00Z') },
      { fetch: fake },
    );
    expect(events.map((e) => e.externalId)).toEqual(['evt1_20261118T043000Z', 'evt2']);
    expect(urls[0]?.searchParams.get('singleEvents')).toBe('true');
    expect(urls[0]?.searchParams.get('orderBy')).toBe('startTime');
    expect(urls[1]?.searchParams.get('pageToken')).toBe('p2');
  });

  it('reports HTTP failures with their status', async () => {
    const fake = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    await expect(
      listCalendarEvents('x', { timeMin: new Date(), timeMax: new Date() }, { fetch: fake }),
    ).rejects.toBeInstanceOf(CalendarHttpError);
  });
});
