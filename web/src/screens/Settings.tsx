import { Banner, Button, Card, Icon, Segmented, useTheme } from '@meetyou/ui';
import { useState } from 'react';

import { useApi } from '../lib/api-context.ts';
import { useAsync } from '../lib/useAsync.ts';

/** DESIGN §15. TODO(S4-12): recording, language, the rest of privacy & data, templates, vocabulary. */
export function Settings({ onSignOut }: { onSignOut: () => void }) {
  const api = useApi();
  const me = useAsync(() => api.me(), []);
  const [theme, setTheme] = useTheme();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="page">
      <header>
        <h1 className="display">Settings</h1>
      </header>
      <Card>
        <div className="setting-row">
          <div>
            <h3 className="setting-title">Appearance</h3>
            <p className="meta">Light is the default. Applies to this browser.</p>
          </div>
          <Segmented
            label="Appearance"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
      </Card>
      <Card>
        <div className="setting-row">
          <div>
            <h3 className="setting-title">Account</h3>
            <p className="meta">{me.data?.email ?? ' '}</p>
          </div>
          <Button onClick={onSignOut}>
            <Icon name="log-out" /> Sign out
          </Button>
        </div>
      </Card>
      <Card>
        <div className="setting-row">
          <div>
            <h3 className="setting-title">Privacy &amp; data</h3>
            <p className="meta">
              Recording, language and the other privacy settings arrive with S4-12.
            </p>
          </div>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete my account and all data…
          </Button>
        </div>
      </Card>
      {confirming && (
        <DeleteAccountAlert
          onCancel={() => setConfirming(false)}
          onDelete={async () => {
            await api.deleteAccount();
            onSignOut();
          }}
        />
      )}
    </div>
  );
}

/** DESIGN §15.3 alert "Delete your account?" (copy from §15.3). */
function DeleteAccountAlert({
  onCancel,
  onDelete,
}: {
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="scrim" role="presentation" onClick={busy ? undefined : onCancel}>
      <div
        className="alert"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        aria-describedby="delete-account-body"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) onCancel();
        }}
      >
        <h2 id="delete-account-title" className="alert-title">
          Delete your account?
        </h2>
        <p id="delete-account-body" className="alert-body">
          Every meeting, note and recording will be permanently deleted within 30 days. This
          can&rsquo;t be undone.
        </p>
        {failed && <Banner tone="error">Your account wasn&rsquo;t deleted. Try again.</Banner>}
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
              onDelete().catch(() => {
                setFailed(true);
                setBusy(false);
              });
            }}
          >
            Delete account
          </Button>
        </div>
      </div>
    </div>
  );
}
