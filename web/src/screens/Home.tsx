import { Banner, Card, Checkbox, SkeletonRows, StatusPill, useToast } from '@meetyou/ui';
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

/** DESIGN §10. TODO(S4-03): setup card driven by sign-in, mic and first-recording state. */
export function Home({ onActionsChanged }: { onActionsChanged: () => void }) {
  const api = useApi();
  const toast = useToast();
  const now = new Date();
  const me = useAsync(() => api.me(), []);
  const recent = useAsync(() => api.listMeetings({ query: '', template: 'all' }), []);
  const todos = useAsync(() => api.listActionItems('open'), []);

  const mine = (todos.data ?? []).filter((row) => row.ownedBySelf).slice(0, 4);

  const toggle = async (id: string, done: boolean) => {
    await api.setActionItemStatus(id, done ? 'done' : 'open');
    todos.reload();
    onActionsChanged();
    if (done) {
      toast({
        message: 'Marked done',
        undo: () => {
          void api.setActionItemStatus(id, 'open').then(() => {
            todos.reload();
            onActionsChanged();
          });
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
          ) : (recent.data ?? []).length === 0 ? (
            <p className="empty">No meetings yet. Join a Google Meet call and press Start.</p>
          ) : (
            <ul className="rows">
              {(recent.data ?? []).slice(0, 4).map((m) => (
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
