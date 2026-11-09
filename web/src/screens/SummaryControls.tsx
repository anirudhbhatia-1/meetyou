import type { Meeting } from '@meetyou/contracts';
import { Banner, Button, Icon } from '@meetyou/ui';
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
  const [open, setOpen] = useState(false);
  return (
    <div className="more">
      <Button
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="refresh-cw" /> {TEMPLATE_LABEL[current]}
      </Button>
      {open && (
        <div
          className="menu"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <p className="menu-helper">Rewrite these notes as…</p>
          {TEMPLATES.map((t, i) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              aria-checked={t === current}
              className="menu-item"
              autoFocus={i === 0}
              onClick={() => {
                setOpen(false);
                if (t !== current) onPick(t);
              }}
            >
              {TEMPLATE_LABEL[t]}
              {t === current && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** DESIGN §12.2: the new version waits until the user keeps it (FR-SUM-07). */
export function CandidateBanner({
  onKeep,
  onGoBack,
}: {
  onKeep: () => void;
  onGoBack: () => void;
}) {
  return (
    <Banner
      tone="info"
      action={
        <span className="banner-actions">
          <Button size="sm" variant="primary" onClick={onKeep}>
            Keep
          </Button>
          <Button size="sm" variant="ghost" onClick={onGoBack}>
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
