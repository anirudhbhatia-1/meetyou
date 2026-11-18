import { useEffect, useRef, useState } from 'react';

import {
  Icon,
  Banner,
  Button,
  Card,
  ChipGroup,
  Menu,
  SearchInput,
  SkeletonRows,
  StatusPill,
  useToast,
} from '@meetyou/ui';
import type { Folder } from '../api/types.ts';
import { useAnalytics } from '../lib/analytics.ts';
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
import { ConfirmAlert } from './ConfirmAlert.tsx';
import { FolderNameSheet, MoveToFolderSheet } from './Folders.tsx';
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
const remembered = { query: '', template: 'all' as Filter, folder: 'all' as string };

/** Open folder dialog (DESIGN §11.1). */
type FolderDialog =
  | { kind: 'new' }
  | { kind: 'rename'; folder: Folder }
  | { kind: 'delete'; folder: Folder }
  | { kind: 'move'; meetingId: string; current: string | null };

/** DESIGN §11 */
export function Meetings() {
  const api = useApi();
  const analytics = useAnalytics();
  const now = new Date();
  const [query, setQuery] = useState(remembered.query);
  const [debounced, setDebounced] = useState(remembered.query);
  const [template, setTemplate] = useState<Filter>(remembered.template);
  const [folder, setFolder] = useState<string>(remembered.folder);
  const [dialog, setDialog] = useState<FolderDialog | null>(null);
  const toast = useToast();
  const folders = useAsync(() => api.listFolders(), []);
  const folderList = folders.data ?? [];
  const folderName = (id: string | null) => folderList.find((f) => f.id === id)?.name ?? null;
  const selected = folderList.find((f) => f.id === folder);

  useEffect(() => {
    remembered.query = query;
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    remembered.template = template;
  }, [template]);
  useEffect(() => {
    remembered.folder = folder;
  }, [folder]);
  // A folder deleted elsewhere (or a remembered one that is gone) falls back to all meetings.
  useEffect(() => {
    if (
      folders.data !== undefined &&
      folder !== 'all' &&
      folder !== 'none' &&
      selected === undefined
    ) {
      setFolder('all');
    }
  }, [folders.data, folder, selected]);

  // DESIGN §11.3: 50 at a time; "Show older meetings" asks for 50 more.
  const [count, setCount] = useState(PAGE);
  useEffect(() => setCount(PAGE), [debounced, template, folder]);
  const list = useAsync(
    () => api.listMeetings({ query: debounced, template, folder }, count),
    [debounced, template, folder, count],
  );
  const refresh = () => {
    folders.reload();
    list.reload();
  };
  const remove = useDeleteMeeting({ deleted: list.reload, restored: list.reload });
  const tracked = useRef('');
  useEffect(() => {
    const q = debounced.trim();
    if (q === '' || list.loading || list.data == null || tracked.current === q) return;
    tracked.current = q;
    analytics.track('library_searched', { results: list.data.meetings.length });
  }, [debounced, list.loading, list.data, analytics]);

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
      {folderList.length > 0 ? (
        <div className="folder-row">
          <ChipGroup
            label="Folder"
            options={[
              { value: 'all', label: 'All folders' },
              { value: 'none', label: 'Unfiled' },
              ...folderList.map((f) => ({ value: f.id, label: f.name })),
            ]}
            value={folder}
            onChange={setFolder}
          />
          {selected !== undefined && (
            <Menu
              round
              label="Folder actions"
              trigger={<Icon name="more-horizontal" />}
              items={[
                {
                  label: 'Rename folder',
                  onSelect: () => setDialog({ kind: 'rename', folder: selected }),
                },
                {
                  label: 'Delete folder…',
                  danger: true,
                  separated: true,
                  onSelect: () => setDialog({ kind: 'delete', folder: selected }),
                },
              ]}
            />
          )}
          <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'new' })}>
            + New folder
          </Button>
        </div>
      ) : (
        folders.data !== undefined && (
          <div className="folder-row">
            <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'new' })}>
              + New folder
            </Button>
          </div>
        )
      )}
      {dialog?.kind === 'new' && (
        <FolderNameSheet
          title="New folder"
          submitLabel="Create"
          onClose={() => setDialog(null)}
          onSave={async (name) => {
            const result = await api.createFolder(name);
            if (result.ok) {
              setDialog(null);
              folders.reload();
            }
            return result;
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <FolderNameSheet
          title="Rename folder"
          submitLabel="Save"
          initial={dialog.folder.name}
          onClose={() => setDialog(null)}
          onSave={async (name) => {
            const result = await api.renameFolder(dialog.folder.id, name);
            if (result.ok) {
              setDialog(null);
              refresh();
            }
            return result;
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmAlert
          title={`Delete “${dialog.folder.name}”?`}
          body="The meetings in it stay in your library, unfiled."
          confirmLabel="Delete folder"
          failedText="The folder wasn’t deleted. Try again."
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            await api.deleteFolder(dialog.folder.id);
            setDialog(null);
            setFolder('all');
            refresh();
            toast({ message: 'Folder deleted' });
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveToFolderSheet
          meetingId={dialog.meetingId}
          current={dialog.current}
          onClose={() => setDialog(null)}
          onMoved={refresh}
        />
      )}
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
            {debounced.trim() === '' && folder === 'none' ? (
              <p>Every meeting is in a folder.</p>
            ) : debounced.trim() === '' && selected !== undefined ? (
              <>
                <p>No meetings in {selected.name} yet.</p>
                <Button variant="ghost" onClick={() => setFolder('all')}>
                  Show all meetings
                </Button>
              </>
            ) : debounced.trim() === '' && template !== 'all' ? (
              <>
                <p>No {TEMPLATE_LABEL[template]} meetings yet.</p>
                <Button variant="ghost" onClick={() => setTemplate('all')}>
                  Show all meetings
                </Button>
              </>
            ) : debounced.trim() === '' ? (
              // DESIGN §16 "Library empty": a heading, then what to do.
              <>
                <h2 className="card-title">No meetings yet</h2>
                <p>
                  Join a Google Meet call and press Start in the MeetYou side panel. Your notes will
                  appear here.
                </p>
              </>
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
                        {[
                          ...m.participantNames,
                          TEMPLATE_LABEL[m.template],
                          ...(folderName(m.folderId) !== null ? [folderName(m.folderId)] : []),
                        ].join(' · ')}
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
                    onMove={() => setDialog({ kind: 'move', meetingId: m.id, current: m.folderId })}
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
