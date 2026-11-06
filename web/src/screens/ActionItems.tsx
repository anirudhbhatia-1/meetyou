import { useState } from 'react';

import { Card, Checkbox, Segmented, SkeletonRows, useToast } from '@meetyou/ui';
import { useApi } from '../lib/api-context.ts';
import { formatDue } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { useAsync } from '../lib/useAsync.ts';

type Filter = 'open' | 'done' | 'all';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
];

/** DESIGN §14 */
export function ActionItems({ onChanged }: { onChanged: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('open');
  const list = useAsync(() => api.listActionItems(filter), [filter]);

  const setStatus = async (id: string, status: 'open' | 'done') => {
    await api.setActionItemStatus(id, status);
    list.reload();
    onChanged();
  };

  return (
    <div className="page">
      <header>
        <h1 className="display">Action items</h1>
        <p className="lede">
          Everything people agreed to do, from all your meetings. Tick it off when it&rsquo;s done.
        </p>
      </header>
      <Segmented label="Show" options={FILTERS} value={filter} onChange={setFilter} />
      <Card className="actions-list">
        {list.loading && list.data === undefined ? (
          <SkeletonRows />
        ) : (list.data ?? []).length === 0 ? (
          <p className="empty">
            {filter === 'done' ? 'Nothing ticked off yet.' : 'Nothing left to do. Nice.'}
          </p>
        ) : (
          <ul>
            {(list.data ?? []).map((row) => {
              const done = row.item.status === 'done';
              return (
                <li key={row.item.id} className="action-row">
                  <Checkbox
                    checked={done}
                    onChange={(checked) => {
                      void setStatus(row.item.id, checked ? 'done' : 'open');
                      if (checked) {
                        toast({
                          message: 'Marked done',
                          undo: () => void setStatus(row.item.id, 'open'),
                        });
                      }
                    }}
                  />
                  <span className="action-main">
                    <span className={`action-text ${done ? 'done' : ''}`}>{row.item.text}</span>
                    <a
                      className="meta link-muted"
                      href={href({ screen: 'detail', meetingId: row.meetingId, tab: 'notes' })}
                    >
                      {row.ownerName} · from {row.meetingTitle}
                    </a>
                  </span>
                  <span className="due num">{formatDue(row.item)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
