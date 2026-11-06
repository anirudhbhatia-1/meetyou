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
  formatLength,
  formatWhen,
  recordingLabel,
  TEMPLATE_LABEL,
  type TemplateId,
} from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { useAsync } from '../lib/useAsync.ts';

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

  const list = useAsync(
    () => api.listMeetings({ query: debounced, template }),
    [debounced, template],
  );

  return (
    <div className="page">
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
        ) : (list.data ?? []).length === 0 ? (
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
            {(list.data ?? []).map((m) => {
              const rec = recordingLabel(m.recordingExpiresAt, now);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className="table-row"
                    onClick={() => navigate({ screen: 'detail', meetingId: m.id, tab: 'notes' })}
                  >
                    <span className="row-main">
                      <span className="row-title">
                        {m.title}
                        {m.video !== null && <Icon name="video" size={14} label="Has video" />}
                      </span>
                      <span className="meta">
                        {m.participantNames.join(', ')} · {TEMPLATE_LABEL[m.template]}
                      </span>
                    </span>
                    <span className="cell">{formatWhen(m.startedAt, now)}</span>
                    <span className="cell num">{formatLength(m.startedAt, m.endedAt)}</span>
                    <span className="cell status-cell">
                      <StatusPill status={m.status} />
                      {rec !== null && <span className="meta small">{rec}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
