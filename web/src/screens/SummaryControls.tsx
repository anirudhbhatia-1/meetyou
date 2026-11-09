import type { Meeting } from '@meetyou/contracts';
import { Banner, Button, Icon, Menu } from '@meetyou/ui';
import { useState } from 'react';

import { TEMPLATE_LABEL } from '../lib/format.ts';

type TemplateId = Meeting['template'];
const TEMPLATES = Object.keys(TEMPLATE_LABEL) as TemplateId[];

/** DESIGN §12.2 regenerate menu: "Rewrite these notes as…" with the current template ticked. */
export function TemplateMenu({
  current,
  disabled,
  onPick,
}: {
  current: TemplateId;
  disabled: boolean;
  onPick: (template: TemplateId) => void;
}) {
  return (
    <Menu
      label={`Template: ${TEMPLATE_LABEL[current]}. Rewrite these notes`}
      helper="Rewrite these notes as…"
      disabled={disabled}
      trigger={
        <>
          <Icon name="refresh-cw" /> {TEMPLATE_LABEL[current]}
        </>
      }
      items={TEMPLATES.map((t) => ({
        label: TEMPLATE_LABEL[t],
        checked: t === current,
        onSelect: () => {
          if (t !== current) onPick(t);
        },
      }))}
    />
  );
}

/** DESIGN §12.2: the new version waits until the user keeps it (FR-SUM-07). */
export function CandidateBanner({
  onKeep,
  onGoBack,
}: {
  onKeep: () => Promise<void>;
  onGoBack: () => Promise<void>;
}) {
  // One click at a time: a second Keep would find no candidate and fail.
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    void action().finally(() => setBusy(false));
  };
  return (
    <Banner
      tone="info"
      action={
        <span className="banner-actions">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => run(onKeep)}>
            Keep
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(onGoBack)}>
            Go back
          </Button>
        </span>
      }
    >
      New version ready
    </Banner>
  );
}

/** DESIGN §12.4 item 8 (FR-SUM-09): "Were these notes useful?" with an optional comment on No. */
export function NotesFeedback({
  onSend,
}: {
  onSend: (useful: boolean, comment?: string) => Promise<void>;
}) {
  const [state, setState] = useState<'ask' | 'comment' | 'sent'>('ask');
  const [comment, setComment] = useState('');
  if (state === 'sent') return <p className="meta small">Thanks for telling us.</p>;
  return (
    <div className="feedback">
      {state === 'ask' ? (
        <>
          <span className="meta">Were these notes useful?</span>
          <Button size="sm" onClick={() => void onSend(true).then(() => setState('sent'))}>
            Yes
          </Button>
          <Button size="sm" onClick={() => setState('comment')}>
            No
          </Button>
        </>
      ) : (
        <>
          <textarea
            aria-label="What was wrong with these notes? (optional)"
            placeholder="What was wrong? (optional)"
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() => void onSend(false, comment).then(() => setState('sent'))}
          >
            Send
          </Button>
        </>
      )}
    </div>
  );
}

/** Per browser: a dismissed banner stays dismissed for that meeting. */
const DISMISSED_KEY = 'minutes.improved-banner.dismissed';

function dismissedIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * DESIGN §12.3 improved-transcript banner (D2, S3-04): shown once the batch pass rewrote the notes
 * (meeting status `updated`), until dismissed. "See what changed" opens the improved transcript.
 * TODO(S4-10): a real before/after view.
 */
export function ImprovedBanner({
  meetingId,
  onSeeChanges,
}: {
  meetingId: string;
  onSeeChanges: () => void;
}) {
  const [hidden, setHidden] = useState(() => dismissedIds().includes(meetingId));
  if (hidden) return null;
  return (
    <div className="improved-banner" role="status">
      <span>We improved this transcript after the call. Your notes were updated to match.</span>
      <Button size="sm" variant="ghost" onClick={onSeeChanges}>
        See what changed
      </Button>
      <button
        type="button"
        className="improved-close"
        aria-label="Dismiss"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(
              DISMISSED_KEY,
              JSON.stringify([...dismissedIds(), meetingId].slice(-200)),
            );
          } catch {
            // Private mode: the banner simply comes back next time.
          }
        }}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
