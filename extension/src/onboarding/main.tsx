import '@meetyou/design-tokens/fonts.css';
import '@meetyou/design-tokens/tokens.css';
import '@meetyou/ui/styles.css';
import './onboarding.css';

import {
  DEFAULT_USER_SETTINGS,
  MEET_CHAT_NOTICE_ENABLED,
  type UserSettings,
} from '@meetyou/contracts';
import { Banner, Button, Checkbox, Icon, Segmented, initTheme } from '@meetyou/ui';
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { API_URL } from '../build-config.ts';
import type { BackgroundMessage } from '../messages.ts';

type Step = 'welcome' | 'mic' | 'prefs' | 'consent' | 'done';
const STEPS: Step[] = ['welcome', 'mic', 'prefs', 'consent'];

async function ask(message: BackgroundMessage): Promise<boolean> {
  try {
    const reply = (await chrome.runtime.sendMessage(message)) as { ok?: unknown } | undefined;
    return reply?.ok === true;
  } catch {
    return false;
  }
}

function Dots({ step }: { step: Step }) {
  const at = STEPS.indexOf(step);
  return (
    <ol
      className="dots"
      aria-label={`Step ${Math.min(at, STEPS.length - 1) + 1} of ${STEPS.length}`}
    >
      {STEPS.map((s, i) => (
        <li key={s} className={i <= at || step === 'done' ? 'dot dot-on' : 'dot'} aria-hidden />
      ))}
    </ol>
  );
}

function Row({ icon, title, line }: { icon: ReactNode; title: string; line: string }) {
  return (
    <li className="ob-row">
      <span className="ob-row-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <span className="meta">{line}</span>
      </span>
    </li>
  );
}

/** DESIGN §7.1 */
function Welcome({ onNext }: { onNext: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const cloud = API_URL !== '';
  return (
    <>
      <h1 className="ob-title">Nothing joins your call.</h1>
      <p className="ob-lede">
        Minutes listens from inside Chrome. It records two audio lanes — your microphone and the
        Meet tab — plus the Meet tab&rsquo;s video, and turns them into a transcript and notes.
      </p>
      <ul className="ob-rows">
        <Row icon={<Icon name="mic" />} title="Me" line="Your microphone" />
        <Row icon={<Icon name="video" />} title="Them" line="The Meet tab" />
        <Row
          icon={<Icon name="maximize" />}
          title="Screen"
          line="What the Meet tab shows; you can turn it off"
        />
        <Row
          icon={<Icon name="check" />}
          title="Never used for training"
          line="Not by us, not by the providers we use"
        />
      </ul>
      {failed && <Banner tone="error">Sign-in didn&rsquo;t finish. Try again.</Banner>}
      <Button
        variant="primary"
        size="lg"
        disabled={busy}
        onClick={() => {
          if (!cloud) {
            onNext();
            return;
          }
          setBusy(true);
          setFailed(false);
          void ask({ target: 'background', type: 'auth.sign_in' }).then((ok) => {
            setBusy(false);
            if (ok) onNext();
            else setFailed(true);
          });
        }}
      >
        {cloud ? 'Continue with Google' : 'Continue'}
      </Button>
      {cloud && <p className="meta small">Only your name and email.</p>}
    </>
  );
}

/** DESIGN §7.2: Chrome can only ask on a visible page; the recorder cannot. */
function Microphone({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<'ask' | 'asking' | 'granted' | 'denied'>('ask');
  return (
    <>
      <div className="ob-card">
        <span className="ob-row-icon">
          <Icon name={state === 'granted' ? 'check' : 'mic'} />
        </span>
        <div>
          <h2 className="ob-card-title">
            {state === 'granted' ? 'Microphone ready' : 'Allow microphone'}
          </h2>
          <p className="meta">Chrome can only ask on this page.</p>
        </div>
      </div>
      {state === 'denied' && (
        <Banner tone="warning">
          Microphone blocked — you can still record the other side of the call. To turn it on, click
          the camera icon in Chrome&rsquo;s address bar on this page and allow the microphone.
        </Banner>
      )}
      {state === 'denied' ? (
        <div className="ob-actions">
          <Button onClick={() => setState('ask')}>Try again</Button>
          <Button variant="primary" onClick={onNext}>
            Record &lsquo;them&rsquo; only
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          size="lg"
          disabled={state !== 'ask'}
          onClick={() => {
            setState('asking');
            navigator.mediaDevices.getUserMedia({ audio: true }).then(
              (stream) => {
                stream.getTracks().forEach((t) => t.stop());
                setState('granted');
                setTimeout(onNext, 900);
              },
              () => setState('denied'),
            );
          }}
        >
          Allow microphone
        </Button>
      )}
    </>
  );
}

type Prefs = Pick<
  UserSettings,
  'transcriptLanguageMode' | 'summaryLanguage' | 'retentionPolicy' | 'consentMode'
>;

/** DESIGN §7.3: skippable with the defaults. */
function Preferences({ onNext }: { onNext: () => void }) {
  const [prefs, setPrefs] = useState<Prefs>({
    transcriptLanguageMode: DEFAULT_USER_SETTINGS.transcriptLanguageMode,
    summaryLanguage: DEFAULT_USER_SETTINGS.summaryLanguage,
    retentionPolicy: DEFAULT_USER_SETTINGS.retentionPolicy,
    consentMode: DEFAULT_USER_SETTINGS.consentMode,
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const set =
    <K extends keyof Prefs>(key: K) =>
    (value: Prefs[K]) =>
      setPrefs((p) => ({ ...p, [key]: value }));
  return (
    <>
      <h1 className="ob-title">A few preferences</h1>
      <p className="ob-lede">You can change any of these later in Settings.</p>
      <div className="ob-prefs">
        <label className="ob-pref">
          <span>What people speak</span>
          <Segmented
            label="What people speak"
            value={prefs.transcriptLanguageMode}
            onChange={set('transcriptLanguageMode')}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'english', label: 'English' },
              { value: 'hindi', label: 'Hindi' },
              { value: 'hinglish', label: 'Hinglish' },
            ]}
          />
        </label>
        <label className="ob-pref">
          <span>Write my notes in</span>
          <Segmented
            label="Write my notes in"
            value={prefs.summaryLanguage}
            onChange={set('summaryLanguage')}
            options={[
              { value: 'english', label: 'English' },
              { value: 'hindi', label: 'हिन्दी' },
              { value: 'hinglish', label: 'Hinglish' },
            ]}
          />
        </label>
        <label className="ob-pref">
          <span>Keep recordings (audio and video)</span>
          <Segmented
            label="Keep recordings"
            value={prefs.retentionPolicy}
            onChange={set('retentionPolicy')}
            options={[
              { value: 'immediate', label: 'Delete after notes' },
              { value: '7d', label: '7 days' },
              { value: '30d', label: '30 days' },
            ]}
          />
        </label>
        {MEET_CHAT_NOTICE_ENABLED && (
          <label className="ob-pref">
            <span>Tell people in Meet chat</span>
            <Segmented
              label="Tell people in Meet chat"
              value={prefs.consentMode}
              onChange={set('consentMode')}
              options={[
                { value: 'one_click', label: 'One click' },
                { value: 'automatic', label: 'Automatic' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </label>
        )}
      </div>
      {failed && (
        <Banner tone="error">These didn&rsquo;t save. Try again, or use the defaults.</Banner>
      )}
      <div className="ob-actions">
        <Button onClick={onNext}>Use defaults</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            if (API_URL === '') {
              onNext();
              return;
            }
            setBusy(true);
            void ask({ target: 'background', type: 'settings.patch', patch: prefs }).then((ok) => {
              setBusy(false);
              if (ok) onNext();
              else setFailed(true);
            });
          }}
        >
          Continue
        </Button>
      </div>
    </>
  );
}

/** DESIGN §7.4 (FR-ONB-06): required before the first recording; the server stores the time. */
function Consent({ onNext }: { onNext: () => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <h1 className="ob-title">One promise</h1>
      <label className="ob-consent">
        <Checkbox checked={checked} onChange={setChecked} />
        <span>
          I&rsquo;ll tell people when I&rsquo;m taking notes, and get consent where required.{' '}
          <span className="meta">
            Minutes can post a note in Meet chat for you; some places need everyone&rsquo;s
            agreement before recording.
          </span>
        </span>
      </label>
      {failed && <Banner tone="error">That didn&rsquo;t save. Try again.</Banner>}
      <Button
        variant="primary"
        size="lg"
        disabled={!checked || busy}
        onClick={() => {
          if (API_URL === '') {
            onNext();
            return;
          }
          setBusy(true);
          void ask({
            target: 'background',
            type: 'settings.patch',
            patch: { consentAcknowledged: true },
          }).then((ok) => {
            setBusy(false);
            if (ok) onNext();
            else setFailed(true);
          });
        }}
      >
        Continue
      </Button>
    </>
  );
}

/** DESIGN §7.5 */
function Done() {
  return (
    <>
      <h1 className="ob-title">You&rsquo;re set.</h1>
      <p className="ob-lede">Join a Google Meet call and press Start.</p>
      <ol className="ob-steps">
        <li>
          <span className="ob-step-n">1</span> Join a call
        </li>
        <li>
          <span className="ob-step-n">2</span> Press Start in the small prompt
        </li>
        <li>
          <span className="ob-step-n">3</span> Read your notes
        </li>
      </ol>
      <Button variant="primary" size="lg" onClick={() => window.close()}>
        Close this tab
      </Button>
    </>
  );
}

/** DESIGN §7: under a minute, one column, four steps then Done. */
function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const next = (to: Step) => () => setStep(to);
  return (
    <main className="ob">
      <Dots step={step} />
      <section className="ob-body" aria-live="polite">
        {step === 'welcome' && <Welcome onNext={next('mic')} />}
        {step === 'mic' && <Microphone onNext={next('prefs')} />}
        {step === 'prefs' && <Preferences onNext={next('consent')} />}
        {step === 'consent' && <Consent onNext={next('done')} />}
        {step === 'done' && <Done />}
      </section>
    </main>
  );
}

initTheme();
const root = document.getElementById('root');
if (root === null) throw new Error('#root missing');
createRoot(root).render(
  <StrictMode>
    <Onboarding />
  </StrictMode>,
);
