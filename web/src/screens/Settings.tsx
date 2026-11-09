import {
  CONSENT_MESSAGE_AUDIO_ONLY,
  DEFAULT_USER_SETTINGS,
  MEET_CHAT_NOTICE_ENABLED,
} from '@meetyou/contracts';
import {
  AlertDialog,
  Banner,
  Button,
  ChipGroup,
  Icon,
  Segmented,
  SkeletonRows,
  Switch,
  TextArea,
  useTheme,
  useToast,
} from '@meetyou/ui';
import { useEffect, useState, type ReactNode } from 'react';

import type { PatchSettingsRequest, UserSettings } from '../api/types.ts';
import { useAnalytics } from '../lib/analytics.ts';
import { useApi } from '../lib/api-context.ts';
import { TEMPLATE_LABEL, type TemplateId } from '../lib/format.ts';
import { useAsync } from '../lib/useAsync.ts';
import { DataExport } from './DataExport.tsx';
import { Vocabulary } from './Vocabulary.tsx';

/** DESIGN §15 inset list: an overline above a card of rows. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-labelledby={`settings-${title}`}>
      <h2 className="overline" id={`settings-${title}`}>
        {title}
      </h2>
      <div className="settings-card">{children}</div>
    </section>
  );
}

function Row({
  title,
  helper,
  control,
  children,
}: {
  title: string;
  helper?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <h3 className="setting-title">{title}</h3>
        {helper !== undefined && <p className="meta">{helper}</p>}
      </div>
      {control !== undefined && <div className="settings-row-control">{control}</div>}
      {children}
    </div>
  );
}

/** FR-SET-06: who processes what. Kept in step with ADR-0001 (STT) and ADR-0007 (summaries). */
const PROCESSORS = [
  { role: 'Speech to text', vendor: 'Deepgram Nova-3, United States', terms: 'Never trains' },
  {
    role: 'Writing summaries and answers',
    vendor: 'Google Gemini API (paid tier)',
    terms: 'Never trains',
  },
  {
    role: 'Hosting and storage, including video',
    vendor: 'Google Cloud, Mumbai',
    terms: 'Never trains',
  },
] as const;

const RETENTION_EFFECT: Record<UserSettings['retentionPolicy'], string> = {
  immediate:
    'Audio is deleted as soon as your notes are ready, and video isn’t recorded. You won’t be able to replay quotes.',
  '7d': 'Audio and video are deleted 7 days after each meeting. Notes and transcripts stay until you delete them.',
  '30d':
    'Audio and video are deleted 30 days after each meeting. Notes and transcripts stay until you delete them.',
};

/**
 * DESIGN §15 (S4-12): every row saves immediately (PATCH /v1/settings); a failed save puts the old
 * value back and says so. The extension reads the same settings when a recording starts.
 */
export function Settings({ onSignOut }: { onSignOut: () => void }) {
  const api = useApi();
  const analytics = useAnalytics();
  const toast = useToast();
  const me = useAsync(() => api.me(), []);
  const loaded = useAsync(() => api.getSettings(), []);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [theme, setTheme] = useTheme();
  const [deleting, setDeleting] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [showProcessors, setShowProcessors] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (loaded.data !== undefined) {
      setSettings(loaded.data);
      setMessage(loaded.data.consentMessage);
    }
  }, [loaded.data]);

  const save = (patch: PatchSettingsRequest) => {
    if (settings === null) return;
    const before = settings;
    setSettings({ ...settings, ...patch } as UserSettings);
    api.patchSettings(patch).then(
      (stored) => setSettings(stored),
      () => {
        setSettings(before);
        toast({ message: 'Couldn’t save that change. Try again.' });
      },
    );
  };

  if (settings === null) {
    return (
      <div className="page">
        <h1 className="display">Settings</h1>
        {loaded.error ? (
          <Banner
            tone="error"
            action={
              <Button size="sm" onClick={loaded.reload}>
                Try again
              </Button>
            }
          >
            Couldn’t load your settings.
          </Banner>
        ) : (
          <SkeletonRows rows={6} />
        )}
      </div>
    );
  }

  const deleteAfterNotes = settings.retentionPolicy === 'immediate';
  const defaultMessage = settings.recordVideo
    ? DEFAULT_USER_SETTINGS.consentMessage
    : CONSENT_MESSAGE_AUDIO_ONLY;

  return (
    <div className="page settings">
      <header>
        <h1 className="display">Settings</h1>
      </header>

      <Section title="Recording">
        <Row
          title="Offer to take notes when I join a call"
          helper="A small prompt appears in Meet. Recording never starts on its own."
          control={
            <Switch
              label="Offer to take notes when I join a call"
              checked={settings.offerPrompt}
              onChange={(offerPrompt) => save({ offerPrompt })}
            />
          }
        />
        {MEET_CHAT_NOTICE_ENABLED && (
          <>
            <Row
              title="Tell people in Meet chat"
              helper="A short note is posted in the call’s chat when recording starts."
              control={
                <Segmented
                  label="Tell people in Meet chat"
                  value={settings.consentMode}
                  onChange={(consentMode) =>
                    consentMode === 'off' ? setConfirmOff(true) : save({ consentMode })
                  }
                  options={[
                    { value: 'one_click', label: 'One click' },
                    { value: 'automatic', label: 'Automatic' },
                    { value: 'off', label: 'Off' },
                  ]}
                />
              }
            />
            <Row title="Consent message" helper="What people see in Meet chat.">
              <div className="settings-row-wide">
                <TextArea
                  aria-label="Consent message"
                  value={message}
                  maxLength={1000}
                  rows={3}
                  onChange={(e) => setMessage(e.target.value)}
                  onBlur={() => {
                    const text = message.trim();
                    if (text !== '' && text !== settings.consentMessage)
                      save({ consentMessage: text });
                    if (text === '') setMessage(settings.consentMessage);
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={settings.consentMessage === defaultMessage}
                  onClick={() => {
                    setMessage(defaultMessage);
                    save({ consentMessage: defaultMessage });
                  }}
                >
                  Reset to default
                </Button>
              </div>
            </Row>
          </>
        )}
        <Row
          title="Pause my mic when I’m muted in Meet"
          helper="Side comments stay off the record."
          control={
            <Switch
              label="Pause my mic when I’m muted in Meet"
              checked={settings.followMeetMute}
              onChange={(followMeetMute) => save({ followMeetMute })}
            />
          }
        />
        <Row
          title="Record video"
          helper={
            deleteAfterNotes
              ? 'Video is off because recordings are deleted as soon as your notes are ready. Video is only kept for replay.'
              : 'Also records what the Meet tab shows — the video grid and anything people present. You can turn it off for a single meeting before you start.'
          }
          control={
            <Switch
              label="Record video"
              checked={settings.recordVideo && !deleteAfterNotes}
              disabled={deleteAfterNotes}
              onChange={(recordVideo) => save({ recordVideo })}
            />
          }
        />
        {settings.recordVideo && !deleteAfterNotes && (
          <Row
            title="Video quality"
            helper="Standard: about 470 MB of upload per hour. Data saver: about 200 MB, for slow or mobile connections. We switch to data saver on our own if the upload falls behind, so audio is never affected."
            control={
              <Segmented
                label="Video quality"
                value={settings.videoQuality}
                onChange={(videoQuality) => save({ videoQuality })}
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'data_saver', label: 'Data saver' },
                ]}
              />
            }
          />
        )}
      </Section>

      <Section title="Language">
        <Row
          title="What people speak"
          control={
            <Segmented
              label="What people speak"
              value={settings.transcriptLanguageMode}
              onChange={(transcriptLanguageMode) => save({ transcriptLanguageMode })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'english', label: 'English' },
                { value: 'hindi', label: 'Hindi' },
                { value: 'hinglish', label: 'Hinglish' },
              ]}
            />
          }
        />
        <Row
          title="Write my notes in"
          helper="Applies to new meetings and when you rewrite notes."
          control={
            <Segmented
              label="Write my notes in"
              value={settings.summaryLanguage}
              onChange={(summaryLanguage) => save({ summaryLanguage })}
              options={[
                { value: 'english', label: 'English' },
                { value: 'hindi', label: 'हिन्दी' },
                { value: 'hinglish', label: 'Hinglish' },
              ]}
            />
          }
        />
        <Row
          title="Show Hindi as"
          control={
            <Segmented
              label="Show Hindi as"
              value={settings.hindiScript}
              onChange={(hindiScript) => save({ hindiScript })}
              options={[
                { value: 'roman', label: 'Roman' },
                { value: 'devanagari', label: 'देवनागरी' },
              ]}
            />
          }
        />
      </Section>

      <Section title="Notes and templates">
        <Row title="Default template" helper="Used for new meetings; any meeting can be rewritten.">
          <div className="settings-row-wide">
            <ChipGroup
              label="Default template"
              value={settings.defaultTemplate}
              onChange={(defaultTemplate: TemplateId) => save({ defaultTemplate })}
              options={(Object.keys(TEMPLATE_LABEL) as TemplateId[]).map((value) => ({
                value,
                label: TEMPLATE_LABEL[value],
              }))}
            />
          </div>
        </Row>
        <Row
          title="Marker words"
          helper="Start a note with DECISION, ACTION, QUESTION or IMPORTANT (or tap a tag) and your notes will put it in the right place."
        />
      </Section>

      <Section title="Vocabulary">
        <Vocabulary />
      </Section>

      <Section title="Privacy and data">
        <Row title="Recording retention" helper="Applies to audio and video.">
          <div className="settings-row-wide">
            <Segmented
              label="Recording retention"
              value={settings.retentionPolicy}
              onChange={(retentionPolicy) => save({ retentionPolicy })}
              options={[
                { value: 'immediate', label: 'Delete after notes' },
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
              ]}
            />
            <p className="settings-effect" role="status">
              {RETENTION_EFFECT[settings.retentionPolicy]}
            </p>
          </div>
        </Row>
        <DataExport />
        <Row
          title="Who processes my data"
          helper={`${PROCESSORS.length} providers · none train on it`}
          control={
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showProcessors}
              onClick={() => setShowProcessors((v) => !v)}
            >
              {showProcessors ? 'Hide' : 'Show'}
            </Button>
          }
        >
          {showProcessors && (
            <ul className="processors settings-row-wide">
              {PROCESSORS.map((p) => (
                <li key={p.role}>
                  <span>
                    <strong>{p.role}</strong> · {p.vendor}
                  </span>
                  <span className="processor-terms">{p.terms}</span>
                </li>
              ))}
              <li className="meta">Video is never sent to the speech or summary providers.</li>
            </ul>
          )}
        </Row>
        <Row
          title="Share anonymous usage counts"
          helper="Never meeting content. Helps us see which features work."
          control={
            <Switch
              label="Share anonymous usage counts"
              checked={!settings.analyticsOptOut}
              onChange={(share) => {
                analytics.setOptOut(!share);
                save({ analyticsOptOut: !share });
              }}
            />
          }
        />
        <Row
          title="Delete my account and all data"
          helper="Every meeting, note and recording is removed."
          control={
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete account…
            </Button>
          }
        />
      </Section>

      <Section title="Appearance">
        <Row
          title="Theme"
          helper="Light is the default. Applies to this browser."
          control={
            <Segmented
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          }
        />
      </Section>

      <Section title="Account">
        <Row
          title={me.data?.name ?? ' '}
          helper={me.data?.email ?? ' '}
          control={
            <Button onClick={onSignOut}>
              <Icon name="log-out" /> Sign out
            </Button>
          }
        />
        <Row
          title="Keyboard shortcuts"
          helper="In Chrome while on a Meet tab: Alt+Shift+R starts or stops notes, Alt+Shift+P pauses (Ctrl+Shift on Mac). Change them at chrome://extensions/shortcuts."
        />
      </Section>

      {confirmOff && (
        // DESIGN §15.1: turning the notice off asks first.
        <AlertDialog
          title="Turn off the chat notice?"
          body="People won’t be told notes are being taken. You are still responsible for telling them."
          confirmLabel="Turn off"
          failedText="That didn’t save. Try again."
          onCancel={() => setConfirmOff(false)}
          onConfirm={async () => {
            const stored = await api.patchSettings({ consentMode: 'off' });
            setSettings(stored);
            setConfirmOff(false);
          }}
        />
      )}
      {deleting && (
        // DESIGN §15.3.
        <AlertDialog
          title="Delete your account?"
          body="Every meeting, note and recording will be permanently deleted within 30 days. This can’t be undone."
          confirmLabel="Delete account"
          failedText="Your account wasn’t deleted. Try again."
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await api.deleteAccount();
            onSignOut();
          }}
        />
      )}
    </div>
  );
}
