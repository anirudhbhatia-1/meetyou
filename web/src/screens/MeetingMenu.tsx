import { Button, Icon, useToast } from '@meetyou/ui';
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

/** DESIGN §12.1 More menu. TODO(S4-10): Rename, Download as .md, Consent log. */
export function MoreMenu({
  onDelete,
  label = 'More actions',
}: {
  onDelete: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="more">
      <Button
        className="icon-btn round"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more-horizontal" />
      </Button>
      {open && (
        <div
          className="menu"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-danger"
            autoFocus
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete meeting…
          </button>
        </div>
      )}
    </div>
  );
}
