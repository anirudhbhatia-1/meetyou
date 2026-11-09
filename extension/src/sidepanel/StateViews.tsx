import { Banner, Button, Icon, Switch, TextArea } from '@meetyou/ui';
import { useState } from 'react';

import type { CaptureState } from '../background/capture-state.ts';
import { API_URL, GATEWAY_URL } from '../build-config.ts';
import { LAST_RECORDING_KEY, parseLastRecording } from '../last-recording.ts';
import {
  ACCOUNT_SETTINGS_KEY,
  accountSettingsFrom,
  noticeTextFor,
  RECORD_VIDEO_KEY,
  recordVideoFrom,
  videoAllowed,
} from '../settings.ts';
import { AccountLine, SignInCard, useAccount } from './Account.tsx';
import { send, sendStart, useLocalSetting } from './hooks.ts';
import { ERROR_TEXT, uploadPercent } from './panel-model.ts';
import { RecordingVideo } from './RecordingVideo.tsx';

/**
 * DESIGN §8.5 consent step (One click): the message to post (editable; the audio-only wording while
 * video is off and the text is unedited), the recording options, Post and start or Skip.
 */
function ConsentStep({ onBack }: { onBack: () => void }) {
  const [account] = useLocalSetting(ACCOUNT_SETTINGS_KEY, accountSettingsFrom);
  const [recordVideo] = useLocalSetting(RECORD_VIDEO_KEY, recordVideoFrom);
  const [text, setText] = useState<string | null>(null);
  if (account === null) return null;
  const video = videoAllowed(account) && (recordVideo ?? true);
  const message = text ?? noticeTextFor(account, video);
  return (
    <section className="state-view">
      <h3 className="state-title">Let everyone know?</h3>
      <p className="state-text">We&rsquo;ll post this in Meet chat. You can edit it first.</p>
      <TextArea
        className="consent-text"
        aria-label="Message to post in Meet chat"
        value={message}
        maxLength={1000}
        onChange={(e) => setText(e.target.value)}
      />
      <RecordingOptions />
      <div className="consent-actions">
        <Button
          variant="primary"
          size="lg"
          disabled={message.trim() === ''}
          onClick={() => sendStart({ post: true, text: message.trim() })}
        >
          Post and start
        </Button>
        <Button size="lg" onClick={() => sendStart({ post: false, text: message.trim() })}>
          Skip
        </Button>
      </div>
      <p className="option-help">
        You&rsquo;re responsible for getting consent where the law requires it.
      </p>
      <Button variant="ghost" size="sm" onClick={onBack}>
        Back
      </Button>
    </section>
  );
}

/**
 * Ready (DESIGN §8.5): Start goes through the consent step when the account's chat notice is One
 * click; Automatic posts and Off skips after recording starts (the service worker decides).
 */
export function ReadyView() {
  const account = useAccount();
  const [settings] = useLocalSetting(ACCOUNT_SETTINGS_KEY, accountSettingsFrom);
  const [asking, setAsking] = useState(false);
  if (asking) return <ConsentStep onBack={() => setAsking(false)} />;
  if (API_URL !== '' && account === null) {
    return (
      <section className="state-view state-center">
        <h3 className="state-title">Nothing joins your call.</h3>
        <SignInCard title="Sign in so your notes and video are saved to your Minutes library." />
      </section>
    );
  }
  return (
    <section className="state-view state-center">
      <h3 className="state-title">Ready when you are</h3>
      <p className="state-text">
        Your mic and the Meet tab are recorded as two separate lanes, so you're always labelled
        correctly.
      </p>
      <LocalOnlyBanner />
      <RecordingOptions />
      <Button
        variant="primary"
        size="lg"
        disabled={API_URL !== '' && account === undefined}
        onClick={() => {
          if (settings?.consentMode === 'one_click') setAsking(true);
          else sendStart();
        }}
      >
        Start taking notes
      </Button>
      {account != null && <AccountLine account={account} />}
      <LastRecordingCard />
    </section>
  );
}

function lastRecordingFrom(items: Record<string, unknown>) {
  return parseLastRecording(items[LAST_RECORDING_KEY]);
}

/** The previous recording's video stays reachable from Ready (see last-recording.ts). */
function LastRecordingCard() {
  const [last] = useLocalSetting(LAST_RECORDING_KEY, lastRecordingFrom);
  if (last === null) return null;
  const when = new Date(last.startedAt).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <div className="options last-recording">
      <span className="option-label">Last recording · {when}</span>
      <RecordingVideo sessionId={last.sessionId} live={false} />
    </div>
  );
}

/** Video of the recording that just ended; keeps refreshing while fragments upload. */
function CallVideo({ sessionId }: { sessionId: string | null }) {
  if (sessionId === null) return null;
  return (
    <div className="options">
      <span className="option-label">Recording</span>
      <RecordingVideo sessionId={sessionId} live />
    </div>
  );
}

/**
 * Recording options card (§8.5, FR-CAP-14). TODO(S4-17): "Video quality" (Standard · Data saver)
 * needs a start-time quality in the offscreen recorder, and the retention "Delete after notes"
 * lock needs Settings (S4-12). "What to record: Whole screen" is P1 (FR-CAP-15).
 */
function RecordingOptions() {
  const [recordVideo, setRecordVideo] = useLocalSetting(RECORD_VIDEO_KEY, recordVideoFrom);
  const [account] = useLocalSetting(ACCOUNT_SETTINGS_KEY, accountSettingsFrom);
  // "Delete after notes" keeps nothing to replay: video is off for every meeting (DESIGN §8.5).
  const locked = account !== null && !videoAllowed(account);
  return (
    <div className="options">
      <div className="option-row">
        <span className="option-label">Record video</span>
        <Switch
          compact
          label="Record video"
          checked={!locked && (recordVideo ?? true)}
          disabled={recordVideo === null || locked}
          onChange={setRecordVideo}
        />
      </div>
      <p className="option-help">
        {locked
          ? 'Video is off because recordings are deleted as soon as your notes are ready. Change this in Settings.'
          : 'Records what the Meet tab shows — the video grid and anything people present. Just for this meeting; the default is in Settings.'}
      </p>
    </div>
  );
}

const STEPS = [
  'Finishing the transcript',
  'Finding decisions and to-dos',
  'Linking every point to what was said',
];

/**
 * Processing (§8.7). TODO(S3-03): the steps fill from the meeting's processing step (SSE); no
 * pipeline runs yet, so all three stay open and the text says so.
 */
export function ProcessingView({
  upload,
  sessionId,
}: {
  upload: UploadProgress;
  sessionId: string | null;
}) {
  return (
    <section className="state-view">
      <h3 className="state-title">Writing your notes…</h3>
      <ol className="steps">
        {STEPS.map((step) => (
          <li key={step} className="step">
            <span className="step-dot" aria-hidden />
            {step}
          </li>
        ))}
      </ol>
      <p className="state-text">
        Notes aren't switched on yet. Your recording and transcript are saved.
      </p>
      <UploadRow upload={upload} />
      <CallVideo sessionId={sessionId} />
      <Button onClick={() => send('recording.dismiss')}>Done</Button>
    </section>
  );
}

/**
 * Ready (§8.7). TODO(S4-14): "Open notes" opens the meeting in the library web app, and the line
 * shows the recorded length and action items, once the meeting API exists.
 */
export function NotesReadyView({
  noteCount,
  upload,
  sessionId,
}: {
  noteCount: number;
  upload: UploadProgress;
  sessionId: string | null;
}) {
  return (
    <section className="state-view state-center">
      <span className="ready-check" aria-hidden>
        <Icon name="check" size={20} />
      </span>
      <h3 className="state-title">Your notes are ready</h3>
      <p className="state-text">
        {noteCount} {noteCount === 1 ? 'note' : 'notes'}
      </p>
      <UploadRow upload={upload} />
      <CallVideo sessionId={sessionId} />
      <Button onClick={() => send('recording.dismiss')}>Done</Button>
    </section>
  );
}

/** Error (§9). TODO(S4-08): "Get help" once a help page exists. */
export function ErrorView({ state }: { state: CaptureState }) {
  if (state.error === 'signed_out') {
    // §9 "Signed out / token expired".
    return (
      <section className="state-view state-center">
        <h3 className="state-title">Recording stopped</h3>
        <SignInCard title={ERROR_TEXT.signed_out} />
        <Button variant="ghost" onClick={() => send('recording.dismiss')}>
          Dismiss
        </Button>
      </section>
    );
  }
  return (
    <section className="state-view state-center">
      <h3 className="state-title">Recording stopped</h3>
      <p className="state-text">
        {state.error === null ? ERROR_TEXT.offscreen_failed : ERROR_TEXT[state.error]}
      </p>
      {/* Chrome refuses a start from the panel here; the toolbar click restarts on its own. */}
      {state.error !== 'capture_not_allowed' && (
        <Button variant="primary" size="lg" onClick={() => send('recording.start')}>
          Start again
        </Button>
      )}
      <Button variant="ghost" onClick={() => send('recording.dismiss')}>
        Dismiss
      </Button>
    </section>
  );
}

type UploadProgress = { pending: number; uploaded: number } | null;

/** "Uploading video — N%" (§8.7, ADR-0011 §3.3); hidden once nothing waits on this computer. */
function UploadRow({ upload }: { upload: UploadProgress }) {
  const percent = upload === null ? null : uploadPercent(upload.pending, upload.uploaded);
  if (percent === null) return null;
  return (
    <div className="upload-row">
      <span className="upload-line">
        <Icon name="video" size={14} />
        <span className="num">Uploading video — {percent}%</span>
        <span
          className="upload-bar"
          role="progressbar"
          aria-label="Video upload"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span className="upload-fill" style={{ width: `${percent}%` }} />
        </span>
      </span>
      <span className="option-help">
        You can close this panel. Keep Chrome open until it finishes.
      </span>
    </div>
  );
}

/**
 * A build without `MINUTES_GATEWAY_URL` records on this computer only: no live transcript, no
 * upload. Said plainly so a local-only build is never mistaken for a broken one.
 * TODO(S5-01): alpha builds always stream; this goes with the developer build.
 */
export function LocalOnlyBanner() {
  if (GATEWAY_URL !== '' || API_URL !== '') return null;
  return (
    <Banner tone="warning">
      Live transcript is off in this build: audio and video stay on this computer. Build with{' '}
      <code>pnpm --filter @meetyou/extension build:dev</code> to stream to the local gateway.
    </Banner>
  );
}
