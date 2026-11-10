import { Banner, Card, Checkbox, Icon, SkeletonRows, StatusPill, useToast } from '@meetyou/ui';
import { useAnalytics } from '../lib/analytics.ts';
import { useApi } from '../lib/api-context.ts';
import {
  formatDue,
  formatLength,
  formatWhen,
  greeting,
  longDate,
  meetingTitle,
  peopleLabel,
} from '../lib/format.ts';
import { href, navigate } from '../lib/router.ts';
import { useAsync } from '../lib/useAsync.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * DESIGN §10 item 3 (A3) setup card. Signed in is true here; the microphone step counts as done
 * once onboarding was finished (its acknowledgement is stored with the account) or a meeting
 * exists — the web app cannot see the extension's permission. Hidden 7 days after completion.
 */
function SetupCard({
  acknowledged,
  meetings,
  now,
}: {
  acknowledged: boolean;
  meetings: readonly { status: string; startedAt: string }[];
  now: Date;
}) {
  const first = meetings
    .filter((m) => m.status === 'ready' || m.status === 'updated')
    .map((m) => Date.parse(m.startedAt))
    .sort((a, b) => a - b)[0];
  const steps = [
    {
      title: 'Sign in with Google',
      line: "Only your name and email. We don't read your calendar or Gmail.",
      done: true,
    },
    {
      title: 'Allow your microphone',
      line: 'So your own voice is in the notes, labelled as you.',
      done: acknowledged || meetings.length > 0,
    },
    {
      title: 'Record your first meeting',
      line: 'Join any Google Meet call and press Start in the small prompt at the top right.',
      done: first !== undefined,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length && first !== undefined && now.getTime() - first > 7 * DAY_MS) {
    return null;
  }
  const current = steps.findIndex((s) => !s.done);
  return (
    <Card className="setup">
      <div className="card-head">
        <h2>{doneCount === steps.length ? 'You’re all set' : 'Get set up in three steps'}</h2>
        <span className="meta num">{doneCount} of 3 done</span>
      </div>
      <div className="setup-bar" aria-hidden="true">
        <span style={{ width: `${(doneCount / 3) * 100}%` }} />
      </div>
      <ol className="setup-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={`setup-step ${i === current ? 'setup-current' : ''}`}>
            <span className={`setup-marker ${s.done ? 'setup-done' : ''}`} aria-hidden="true">
              {s.done ? <Icon name="check" size={14} /> : i + 1}
            </span>
            <span className="setup-text">
              <strong>
                {s.title}
                {s.done && <span className="visually-hidden"> (done)</span>}
              </strong>
              <span className="meta">{s.line}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** DESIGN §10 */
export function Home({ onActionsChanged }: { onActionsChanged: () => void }) {
  const api = useApi();
  const analytics = useAnalytics();
  const toast = useToast();
  const now = new Date();
  const me = useAsync(() => api.me(), []);
  const recent = useAsync(() => api.listMeetings({ query: '', template: 'all' }, 4), []);
  const todos = useAsync(() => api.listActionItems('open'), []);
  const settings = useAsync(() => api.getSettings(), []);

  const mine = (todos.data ?? []).filter((row) => row.ownedBySelf).slice(0, 4);

  const toggle = async (id: string, done: boolean) => {
    try {
      await api.setActionItemStatus(id, done ? 'done' : 'open');
    } catch {
      // Like the Action items page: say so, and let the reload put the checkbox back.
      toast({ message: 'Couldn’t save that. Try again.' });
      todos.reload();
      return;
    }
    analytics.track('action_item_status', { status: done ? 'done' : 'open' });
    todos.reload();
    onActionsChanged();
    if (done) {
      toast({
        message: 'Marked done',
        undo: () => {
          api.setActionItemStatus(id, 'open').then(
            () => {
              todos.reload();
              onActionsChanged();
            },
            () => toast({ message: 'Couldn’t undo that. Try again.' }),
          );
        },
      });
    }
  };

  return (
    <div className="page home">
      <header>
        <p className="meta">{longDate(now)}</p>
        <h1 className="display">
          {me.data === undefined ? ' ' : greeting(now, me.data.firstName)}
        </h1>
      </header>
      {(recent.error || todos.error) && (
        <Banner
          tone="error"
          action={
            <button
              type="button"
              className="link"
              onClick={() => {
                recent.reload();
                todos.reload();
              }}
            >
              Try again
            </button>
          }
        >
          Something went wrong. Try again.
        </Banner>
      )}
      {recent.data !== undefined && settings.data !== undefined && (
        <SetupCard
          acknowledged={settings.data.consentAcknowledgedAt !== null}
          meetings={recent.data.meetings}
          now={now}
        />
      )}
      <div className="home-columns">
        <Card>
          <div className="card-head">
            <h2>Recent meetings</h2>
            <a className="link" href={href({ screen: 'meetings' })}>
              See all
            </a>
          </div>
          {recent.loading && recent.data === undefined ? (
            <SkeletonRows />
          ) : (recent.data?.meetings ?? []).length === 0 ? (
            <p className="empty">No meetings yet. Join a Google Meet call and press Start.</p>
          ) : (
            <ul className="rows">
              {(recent.data?.meetings ?? []).slice(0, 4).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="row-button"
                    onClick={() => navigate({ screen: 'detail', meetingId: m.id, tab: 'notes' })}
                  >
                    <span className="row-main">
                      <span className="row-title">{meetingTitle(m)}</span>
                      <span className="meta">
                        {formatWhen(m.startedAt, now)} · {formatLength(m.startedAt, m.endedAt)} ·{' '}
                        {peopleLabel(m.participantNames.length)}
                      </span>
                    </span>
                    <StatusPill status={m.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="card-head">
            <h2>Your to-dos</h2>
            <a className="link" href={href({ screen: 'actions' })}>
              See all
            </a>
          </div>
          {todos.loading && todos.data === undefined ? (
            <SkeletonRows />
          ) : mine.length === 0 ? (
            <p className="empty">You&rsquo;re all caught up.</p>
          ) : (
            <ul className="todos">
              {mine.map((row) => (
                <li key={row.item.id}>
                  <Checkbox
                    checked={row.item.status === 'done'}
                    onChange={(c) => void toggle(row.item.id, c)}
                  />
                  <span>
                    <span className="todo-text">{row.item.text}</span>
                    <span className="meta small">
                      {formatDue(row.item)} · from {row.meetingTitle}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
