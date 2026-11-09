import { useEffect, useState } from 'react';

import {
  Icon,
  Banner,
  Button,
  Card,
  ChipGroup,
  SearchInput,
  SkeletonRows,
  StatusPill,
} from '@meetyou/ui';
import { useApi } from '../lib/api-context.ts';
import {
  TEMPLATE_LABEL,
  formatLength,
  formatWhen,
  meetingTitle,
  recordingLabel,
  type TemplateId,
} from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { useAsync } from '../lib/useAsync.ts';
import { MoreMenu, useDeleteMeeting } from './MeetingMenu.tsx';

/** DESIGN §11.3 page size. */
const PAGE = 50;

type Filter = TemplateId | 'all';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...(Object.entries(TEMPLATE_LABEL) as [TemplateId, string][]).map(([value, label]) => ({
    value,
    label,
  })),
];

/** Kept across navigation so Back from detail restores search and filter (DESIGN §3). */
const remembered = { query: '', template: 'all' as Filter };

/** DESIGN §11 */
export function Meetings() {
  const api = useApi();
  const now = new Date();
  const [query, setQuery] = useState(remembered.query);
  const [debounced, setDebounced] = useState(remembered.query);
  const [template, setTemplate] = useState<Filter>(remembered.template);

  useEffect(() => {
    remembered.query = query;
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    remembered.template = template;
  }, [template]);

  // DESIGN §11.3: 50 at a time; "Show older meetings" asks for 50 more.
  const [count, setCount] = useState(PAGE);
  useEffect(() => setCount(PAGE), [debounced, template]);
  const list = useAsync(
    () => api.listMeetings({ query: debounced, template }, count),
    [debounced, template, count],
  );
  const remove = useDeleteMeeting({ deleted: list.reload, restored: list.reload });

  return (
    <div className="page">
      {remove.alert}
      <header className="page-head">
        <h1 className="display">Meetings</h1>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search words, people, or decisions"
          label="Search meetings"
        />
      </header>
      <ChipGroup label="Template" options={FILTERS} value={template} onChange={setTemplate} />
      {list.error && (
        <Banner
          tone="error"
          action={
            <Button variant="ghost" size="sm" onClick={list.reload}>
              Try again
            </Button>
          }
        >
          Something went wrong. Try again.
        </Banner>
      )}
      <Card className="table">
        <div className="table-head" aria-hidden>
          <span>Meeting</span>
          <span>When</span>
          <span>Length</span>
          <span>Status</span>
        </div>
        {list.loading && list.data === undefined ? (
          <SkeletonRows />
        ) : (list.data?.meetings ?? []).length === 0 ? (
          <div className="empty">
            {debounced.trim() === '' ? (
              <p>
                No meetings yet. Join a Google Meet call and press Start. Your notes will appear
                here.
              </p>
            ) : (
              <>
                <p>No meetings match &ldquo;{debounced}&rdquo;.</p>
                <Button variant="ghost" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              </>
            )}
          </div>
        ) : (
          <ul>
            {(list.data?.meetings ?? []).map((m) => {
              const rec = recordingLabel(m.recordingExpiresAt, now);
              return (
                <li key={m.id} className="table-line">
                  <button
                    type="button"
                    className="table-row"
                    onClick={() => navigate({ screen: 'detail', meetingId: m.id, tab: 'notes' })}
                  >
                    <span className="row-main">
                      <span className="row-title">
                        {meetingTitle(m)}
                        {m.video !== null && <Icon name="video" size={14} label="Has video" />}
                      </span>
                      <span className="meta">
                        {[...m.participantNames, TEMPLATE_LABEL[m.template]].join(' · ')}
                      </span>
                    </span>
                    <span className="cell">{formatWhen(m.startedAt, now)}</span>
                    <span className="cell num">{formatLength(m.startedAt, m.endedAt)}</span>
                    <span className="cell status-cell">
                      <StatusPill status={m.status} />
                      {rec !== null && <span className="meta small">{rec}</span>}
                    </span>
                  </button>
                  <MoreMenu
                    label={`More actions for ${meetingTitle(m)}`}
                    onDelete={() => remove.request(m.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {list.data?.more === true && (
          <div className="list-more">
            <Button variant="ghost" onClick={() => setCount((n) => n + PAGE)}>
              Show older meetings
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
