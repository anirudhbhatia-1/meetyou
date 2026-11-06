import { Banner, Button } from '@meetyou/ui';
import { useState, type ReactNode } from 'react';

/**
 * Destructive confirm alert (DESIGN §6, §13.3, §15.3): title, one-paragraph body, Cancel (focused)
 * and the danger action. Escape and the scrim cancel unless the action is running.
 */
export function ConfirmAlert({
  title,
  body,
  confirmLabel,
  failedText,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  failedText: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="scrim" role="presentation" onClick={busy ? undefined : onCancel}>
      <div
        className="alert"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-alert-title"
        aria-describedby="confirm-alert-body"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onCancel();
        }}
      >
        <h2 id="confirm-alert-title" className="alert-title">
          {title}
        </h2>
        <p id="confirm-alert-body" className="alert-body">
          {body}
        </p>
        {failed && <Banner tone="error">{failedText}</Banner>}
        <div className="alert-actions">
          <Button autoFocus disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFailed(false);
              onConfirm().catch(() => {
                setFailed(true);
                setBusy(false);
              });
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
