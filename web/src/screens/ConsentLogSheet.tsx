import { Button, Sheet, SkeletonRows } from '@meetyou/ui';

import type { ConsentLogEntry, Meeting } from '../api/types.ts';
import { useApi } from '../lib/api-context.ts';
import { meetingTitle } from '../lib/format.ts';
import { saveTextFile } from '../lib/notes-doc.ts';
import { useAsync } from '../lib/useAsync.ts';

const MODE: Record<ConsentLogEntry['mode'], string> = {
  one_click: 'One click',
  automatic: 'Automatic',
  off: 'Off',
};
const OUTCOME: Record<ConsentLogEntry['outcome'], string> = {
  posted: 'Yes',
  skipped: 'No',
  failed: 'Failed',
};

const time = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** DESIGN §13.4 consent log (FR-CON-03): read-only, exportable as .txt. */
export function ConsentLogSheet({ meeting, onClose }: { meeting: Meeting; onClose: () => void }) {
  const api = useApi();
  const log = useAsync(() => api.getConsentLog(meeting.id), [meeting.id]);
  const entries = log.data ?? [];
  const exportText = () =>
    [
      `Consent log — ${meetingTitle(meeting)}`,
      '',
      ...entries.flatMap((e) => [
        `${time(e.sentAt ?? e.createdAt)} · ${MODE[e.mode]} · Note posted: ${OUTCOME[e.outcome]}`,
        ...(e.noticeText !== null ? [`  "${e.noticeText}"`] : []),
      ]),
      '',
    ].join('\n');
  return (
    <Sheet
      title="Consent log"
      onClose={onClose}
      footer={
        <Button
          disabled={entries.length === 0}
          onClick={() =>
            saveTextFile(
              `consent-log-${meeting.startedAt.slice(0, 10)}.txt`,
              exportText(),
              'text/plain',
            )
          }
        >
          Export (.txt)
        </Button>
      }
    >
      {log.loading && log.data === undefined ? (
        <SkeletonRows rows={2} />
      ) : log.error ? (
        <p className="meta">Couldn’t load the consent log. Close and try again.</p>
      ) : entries.length === 0 ? (
        <p className="meta">No consent notice was recorded for this meeting.</p>
      ) : (
        <ul className="consent-log">
          {entries.map((e) => (
            <li key={e.id}>
              <p className="meta num">
                {time(e.sentAt ?? e.createdAt)} · {MODE[e.mode]} · Note posted: {OUTCOME[e.outcome]}
              </p>
              {e.noticeText !== null && <p className="consent-text">“{e.noticeText}”</p>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
