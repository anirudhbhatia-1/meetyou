import { Banner, Button, Card, Sheet, SkeletonRows, TextArea, useToast } from '@meetyou/ui';
import { useEffect, useState } from 'react';

import type { UpcomingMeeting } from '../api/types.ts';
import { useApi } from '../lib/api-context.ts';
import { clockTime } from '../lib/format.ts';
import { href, navigate } from '../lib/router.ts';
import { useAsync } from '../lib/useAsync.ts';

const SHOWN = 5;
const MAX_NOTES = 30;

const clock = clockTime;
/** While the first sync is pending, look again this often, at most this many times. */
const SYNC_POLL_MS = 15_000;
const SYNC_POLLS = 8;

/** "10:00–10:30", or "Tomorrow 09:30" for tomorrow's calls (DESIGN §10.1). */
export function whenLabel(m: Pick<UpcomingMeeting, 'startsAt' | 'endsAt'>, now: Date): string {
  const start = new Date(m.startsAt);
  const sameDay = start.toDateString() === now.toDateString();
  return sameDay ? `${clock(m.startsAt)}–${clock(m.endsAt)}` : `Tomorrow ${clock(m.startsAt)}`;
}

/** First three names, then "+n". */
export function namesLabel(names: readonly string[]): string {
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

/** Today 00:00 to the end of tomorrow, in the viewer's time zone. */
function dayWindow(now: Date): { from: Date; to: Date } {
  const from = new Date(now);
  const to = new Date(now);
  to.setDate(to.getDate() + 2);
  to.setHours(0, 0, 0, 0);
  return { from, to };
}

/** DESIGN §10.1: the next Meet calls from the connected Google Calendar. */
export function UpNext({ now }: { now: Date }) {
  const api = useApi();
  const [{ from, to }] = useState(() => dayWindow(now));
  const upcoming = useAsync(() => api.upcoming(from, to), [from, to]);
  const [notesFor, setNotesFor] = useState<UpcomingMeeting | null>(null);
  const [polls, setPolls] = useState(0);
  const data = upcoming.data;
  const syncing = data?.calendar.lastSyncedAt === null && data.calendar.status === 'active';
  // Just connected: the first sync is queued; look again until it lands (≈ 2 min at most).
  useEffect(() => {
    if (!syncing || polls >= SYNC_POLLS) return undefined;
    const timer = setTimeout(() => {
      setPolls((n) => n + 1);
      upcoming.reload();
    }, SYNC_POLL_MS);
    return () => clearTimeout(timer);
  }, [syncing, polls, upcoming]);
  // Nothing while loading or without a calendar, so Home does not flash an empty card.
  if (data === undefined || !data.calendar.connected) return null;
  const meetings = data.meetings;
  const shown = meetings.slice(0, SHOWN);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const moreTomorrow = meetings
    .slice(SHOWN)
    .filter((m) => new Date(m.startsAt).toDateString() === tomorrow.toDateString()).length;
  const moreToday = meetings.length - shown.length - moreTomorrow;
  const synced = data.calendar.lastSyncedAt;
  return (
    <Card className="up-next">
      <div className="card-head">
        <h2>Up next</h2>
        <span className="meta">
          From your Google Calendar
          {synced !== null && ` · updated ${clock(synced)}`}
        </span>
      </div>
      {data.calendar.status === 'needs_reconnect' && (
        <Banner
          tone="warning"
          action={
            <Button size="sm" onClick={() => navigate({ screen: 'settings' })}>
              Settings
            </Button>
          }
        >
          Your calendar stopped syncing. Reconnect it in Settings.
        </Banner>
      )}
      {syncing ? (
        <p className="empty">Syncing your calendar… this takes up to a minute.</p>
      ) : shown.length === 0 ? (
        <p className="empty">No Meet calls today or tomorrow.</p>
      ) : (
        <ul className="rows">
          {shown.map((m) => (
            <li key={m.id} className="up-next-row">
              <span className="up-next-time num">{whenLabel(m, now)}</span>
              <span className="row-main">
                <span className="row-title">{m.title || 'Untitled event'}</span>
                <span className="meta">{namesLabel(m.attendeeNames)}</span>
                {m.noteCount > 0 && (
                  <span className="note-chip">
                    {m.noteCount} {m.noteCount === 1 ? 'note' : 'notes'}
                  </span>
                )}
              </span>
              <span className="up-next-actions">
                {m.meetingId !== null ? (
                  <a
                    className="link"
                    href={href({ screen: 'detail', meetingId: m.meetingId, tab: 'notes' })}
                  >
                    Recorded
                  </a>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Notes for ${m.title || 'this call'}`}
                      onClick={() => setNotesFor(m)}
                    >
                      Notes
                    </Button>
                    {m.meetCode !== null && (
                      <a
                        className="btn btn-ghost btn-sm"
                        href={`https://meet.google.com/${m.meetCode}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Join ${m.title || 'this call'} in Google Meet (opens a new tab)`}
                      >
                        Join
                      </a>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(moreToday > 0 || moreTomorrow > 0) && (
        <p className="meta">
          {[
            ...(moreToday > 0 ? [`${moreToday} more today`] : []),
            ...(moreTomorrow > 0 ? [`${moreTomorrow} more tomorrow`] : []),
          ].join(' · ')}
        </p>
      )}
      {notesFor !== null && (
        <EventNotesSheet
          meeting={notesFor}
          onClose={() => setNotesFor(null)}
          onSaved={upcoming.reload}
        />
      )}
    </Card>
  );
}

/** DESIGN §10.1 "Notes before the call": one note per line, up to 30. */
export function EventNotesSheet({
  meeting,
  onClose,
  onSaved,
}: {
  meeting: UpcomingMeeting;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A failed load must not look like "no notes": saving would replace the stored ones.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoadFailed(false);
    api.getEventNotes(meeting.id).then(
      (notes) => current && setText(notes.join('\n')),
      () => current && setLoadFailed(true),
    );
    return () => {
      current = false;
    };
  }, [api, meeting.id, attempt]);
  const lines = (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const tooMany = lines.length > MAX_NOTES;
  return (
    <Sheet
      title={`Notes for ${meeting.title || 'this call'}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={text === null || busy || tooMany}
            onClick={() => {
              setBusy(true);
              api
                .saveEventNotes(
                  meeting.id,
                  lines.map((l) => l.slice(0, 2000)),
                )
                .then(
                  () => {
                    toast({ message: 'Notes saved' });
                    onSaved();
                    onClose();
                  },
                  () => {
                    setBusy(false);
                    toast({ message: 'Couldn’t save your notes. Try again.' });
                  },
                );
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <p className="meta">
        What do you want to cover? Each line becomes a heading in your notes, and the summary fills
        it in.
      </p>
      {loadFailed ? (
        <Banner
          tone="error"
          action={
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          Couldn’t load your notes. Try again.
        </Banner>
      ) : text === null ? (
        <SkeletonRows rows={2} />
      ) : (
        <TextArea
          autoFocus
          rows={8}
          value={text}
          aria-label="Notes before the call"
          placeholder={'Pricing for Q1\nWho owns onboarding?'}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      {tooMany && (
        <p className="field-error" role="alert">
          Up to {MAX_NOTES} notes. Remove {lines.length - MAX_NOTES}.
        </p>
      )}
    </Sheet>
  );
}
