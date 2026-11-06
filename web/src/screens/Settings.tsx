import { Button, Card, Icon, Segmented, useTheme } from '@meetyou/ui';
import { useState } from 'react';

import { useApi } from '../lib/api-context.ts';
import { useAsync } from '../lib/useAsync.ts';
import { ConfirmAlert } from './ConfirmAlert.tsx';

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
        // DESIGN §15.3.
        <ConfirmAlert
          title="Delete your account?"
          body="Every meeting, note and recording will be permanently deleted within 30 days. This can’t be undone."
          confirmLabel="Delete account"
          failedText="Your account wasn’t deleted. Try again."
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await api.deleteAccount();
            onSignOut();
          }}
        />
      )}
    </div>
  );
}
