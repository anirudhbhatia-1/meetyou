import { Icon, Menu, useToast, type MenuEntry } from '@meetyou/ui';
import { useState, type ReactNode } from 'react';

import { useApi } from '../lib/api-context.ts';
import { ConfirmAlert } from './ConfirmAlert.tsx';

/**
 * DESIGN §13.3 delete with undo, shared by the Meetings list and meeting detail: the alert, the
 * soft delete, and the "Meeting deleted" toast whose Undo restores it within the server's grace
 * period. `deleted`/`restored` let each screen refresh or navigate.
 */
export function useDeleteMeeting(after: {
  deleted: (id: string) => void;
  restored: (id: string) => void;
}): { request: (id: string) => void; alert: ReactNode } {
  const api = useApi();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const alert =
    pending === null ? null : (
      <ConfirmAlert
        title="Delete this meeting?"
        body="Its audio, video, transcript, notes and action items will be removed. You can undo for a few seconds."
        confirmLabel="Delete"
        failedText="The meeting wasn’t deleted. Try again."
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const id = pending;
          await api.deleteMeeting(id);
          setPending(null);
          after.deleted(id);
          toast({
            message: 'Meeting deleted',
            undo: () => {
              void api.restoreMeeting(id).then(
                () => after.restored(id),
                () => toast({ message: 'Too late to undo — the meeting is already deleted.' }),
              );
            },
          });
        }}
      />
    );
  return { request: setPending, alert };
}

/** DESIGN §12.1 More menu: Rename · Download as .md · Consent log · Delete meeting… */
export function MoreMenu({
  onDelete,
  onDownload,
  onRename,
  onConsentLog,
  label = 'More actions',
}: {
  onDelete: () => void;
  /** DESIGN §13.2 "Download as .md"; absent while there are no notes to download. */
  onDownload?: () => void;
  onRename?: () => void;
  onConsentLog?: () => void;
  label?: string;
}) {
  const items: MenuEntry[] = [
    ...(onRename !== undefined ? [{ label: 'Rename', onSelect: onRename }] : []),
    ...(onDownload !== undefined ? [{ label: 'Download as .md', onSelect: onDownload }] : []),
    ...(onConsentLog !== undefined ? [{ label: 'Consent log', onSelect: onConsentLog }] : []),
    { label: 'Delete meeting…', onSelect: onDelete, danger: true, separated: true },
  ];
  return <Menu round label={label} trigger={<Icon name="more-horizontal" />} items={items} />;
}
