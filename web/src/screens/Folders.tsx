import { Button, Sheet, TextInput, useToast } from '@meetyou/ui';
import { useId, useState } from 'react';

import type { Folder, FolderSaveError, FolderSaveResult } from '../api/types.ts';
import { useApi } from '../lib/api-context.ts';
import { useAsync } from '../lib/useAsync.ts';

/** DESIGN §11.1 error lines under the folder name input. */
export const FOLDER_ERROR: Record<FolderSaveError, string> = {
  exists: 'A folder with this name already exists.',
  invalid: 'Use 1–60 characters.',
  too_many: 'You can have up to 100 folders.',
  failed: 'Couldn’t save the folder. Try again.',
};

/** DESIGN §11.1: "New folder" / "Rename folder" sheet with one input. */
export function FolderNameSheet({
  title,
  submitLabel,
  initial = '',
  onSave,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial?: string;
  onSave: (name: string) => Promise<FolderSaveResult>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 60) {
      setError(FOLDER_ERROR.invalid);
      return;
    }
    setBusy(true);
    const result = await onSave(trimmed).catch((): FolderSaveResult => ({
      ok: false,
      error: 'failed',
    }));
    setBusy(false);
    if (!result.ok) setError(FOLDER_ERROR[result.error]);
  };
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="folder-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextInput
          autoFocus
          value={name}
          maxLength={60}
          aria-label="Folder name"
          placeholder="e.g. Client calls"
          aria-invalid={error !== null}
          aria-describedby={error !== null ? errorId : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        {error !== null && (
          <p id={errorId} className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

/**
 * DESIGN §11.1 item 4: "Move to folder" — folders A→Z plus No folder; choosing one moves at once.
 * The last row creates a folder and moves the meeting into it.
 */
export function MoveToFolderSheet({
  meetingId,
  current,
  onMoved,
  onClose,
}: {
  meetingId: string;
  current: string | null;
  onMoved: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const folders = useAsync(() => api.listFolders(), []);
  const [creating, setCreating] = useState(false);
  const nameOf = (id: string | null, list: Folder[]) => list.find((f) => f.id === id)?.name ?? '';

  const [moving, setMoving] = useState(false);
  /** True when the meeting moved. */
  const move = async (folderId: string | null, list: Folder[]): Promise<boolean> => {
    if (folderId === current) {
      onClose();
      return true;
    }
    if (moving) return false;
    setMoving(true);
    try {
      await api.moveMeeting(meetingId, folderId);
      toast({
        message:
          folderId === null
            ? `Removed from ${nameOf(current, list)}`
            : `Moved to ${nameOf(folderId, list)}`,
      });
      onMoved(folderId);
      onClose();
      return true;
    } catch {
      toast({ message: 'Couldn’t move the meeting. Try again.' });
      return false;
    } finally {
      setMoving(false);
    }
  };

  if (creating) {
    return (
      <FolderNameSheet
        title="New folder"
        submitLabel="Create"
        onClose={() => setCreating(false)}
        onSave={async (name) => {
          const result = await api.createFolder(name);
          if (result.ok && !(await move(result.folder.id, [result.folder]))) {
            // The folder exists now; back to the list, where it can be picked again.
            setCreating(false);
            folders.reload();
            onMoved(current);
          }
          return result;
        }}
      />
    );
  }

  const list = folders.data ?? [];
  return (
    <Sheet title="Move to folder" onClose={onClose}>
      {folders.error ? (
        <p className="meta">Couldn’t load your folders. Close this and try again.</p>
      ) : (
        <ul className="folder-pick" role="radiogroup" aria-label="Folder">
          {[{ id: null, name: 'No folder' } as const, ...list].map((f) => (
            <li key={f.id ?? 'none'}>
              <button
                type="button"
                role="radio"
                aria-checked={f.id === current}
                className="folder-pick-row"
                disabled={moving || (folders.loading && folders.data === undefined)}
                onClick={() => void move(f.id, list)}
              >
                <span className="folder-pick-mark" aria-hidden>
                  {f.id === current ? '✓' : ''}
                </span>
                {f.name}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="folder-pick-row" onClick={() => setCreating(true)}>
              <span className="folder-pick-mark" aria-hidden>
                +
              </span>
              New folder
            </button>
          </li>
        </ul>
      )}
    </Sheet>
  );
}
