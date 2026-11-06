import { Card, Segmented, useTheme } from '@meetyou/ui';

/** DESIGN §15. TODO(S4-12): recording, language, privacy & data, templates, vocabulary, account. */
export function Settings() {
  const [theme, setTheme] = useTheme();
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
        <p className="meta">
          Recording, language, privacy and account settings arrive with the settings API (S2-09) and
          S4-12.
        </p>
      </Card>
    </div>
  );
}
