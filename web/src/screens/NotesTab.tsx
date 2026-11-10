import type { Segment, SummaryItem } from '@meetyou/contracts';
import {
  Button,
  Card,
  CitationChip,
  Icon,
  SkeletonRows,
  TextArea,
  UnverifiedChip,
  useToast,
} from '@meetyou/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { Meeting, MeetingSummary, Participant } from '../api/types.ts';
import { useApi } from '../lib/api-context.ts';
import { numberCitations } from '../lib/citations.ts';
import { formatClock, segmentLang } from '../lib/format.ts';
import { MinutesView } from './MinutesView.tsx';
import { NotesFeedback } from './SummaryControls.tsx';

/** DESIGN §12.6: the popover appears within 200 ms of hover or focus. */
const POPOVER_DELAY_MS = 150;

/** DESIGN §12.6 hover/focus popover: speaker, quote and time of the first cited line. */
function CitePopover({ item, segments }: { item: SummaryItem; segments: Segment[] }) {
  const first = segments.find((s) => item.segmentIds.includes(s.id));
  if (first === undefined) return null;
  return (
    <span className="cite-popover" role="tooltip">
      <span className="speaker">
        {first.lane === 'me' ? 'You' : (first.speakerName ?? 'Speaker')} ·{' '}
        <span className="num">{formatClock(first.startMs)}</span>
      </span>
      <span className="cite-popover-quote" lang={segmentLang(first.language, first.text)}>
        “{first.text}”
      </span>
    </span>
  );
}

/**
 * One AI bullet (DESIGN §12.4): citation chip with hover popover, unverified chip instead of a
 * citation, and inline edit (pencil on hover/focus; "edited" once saved, FR-SUM-08).
 */
export function Bullet({
  item,
  n,
  selected,
  segments,
  onSelect,
  onEdited,
}: {
  item: SummaryItem;
  n: number | undefined;
  selected: boolean;
  segments: Segment[];
  onSelect: () => void;
  onEdited: (item: SummaryItem) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const show = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(true), POPOVER_DELAY_MS);
  };
  const hide = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    setPeek(false);
  };

  const saving = useRef(false);
  const save = () => {
    // Enter saves and unmounts the textarea, whose removal fires blur → a second PATCH
    // (2026-11-09 audit). One save per edit.
    if (saving.current) return;
    saving.current = true;
    const text = draft.trim();
    setEditing(false);
    if (text === '' || text === item.text) {
      setDraft(item.text);
      return;
    }
    api.editSummaryItem(item.id, { text }).then(onEdited, () => {
      setDraft(item.text);
      toast({ message: 'Couldn’t save your edit. Try again.' });
    });
  };

  if (editing) {
    return (
      <li className="ai-line ai-line-editing">
        <TextArea
          aria-label="Edit this point"
          autoFocus
          rows={2}
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            } else if (e.key === 'Escape') {
              setDraft(item.text);
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }
  return (
    <li className={`ai-line ${item.flagged && !item.userEdited ? 'unverified' : ''}`}>
      <span>{item.text}</span>
      {item.userEdited && <span className="edited-label">edited</span>}
      {item.flagged && !item.userEdited ? (
        // DESIGN §6.14: never a citation chip on an unverified item.
        <UnverifiedChip />
      ) : (
        n !== undefined && (
          <span
            className="cite-wrap"
            onMouseEnter={show}
            onMouseLeave={hide}
            onFocus={show}
            onBlur={hide}
          >
            <CitationChip n={n} selected={selected} onSelect={onSelect} />
            {peek && <CitePopover item={item} segments={segments} />}
          </span>
        )
      )}
      <button
        type="button"
        className="edit-btn"
        aria-label="Edit this point"
        onClick={() => {
          saving.current = false;
          setEditing(true);
        }}
      >
        <Icon name="pencil" size={14} />
      </button>
    </li>
  );
}

/** DESIGN §12.4 Notes tab. */
export function NotesTab({
  fading,
  onFeedback,
  summary,
  segments,
  loading,
  selected,
  onSelect,
  onEdited,
  onRetry,
  status,
  meeting,
  people,
}: {
  /** Needed for the Minutes of meeting layout (details and owners). */
  meeting: Meeting | null;
  people: Participant[];
  fading: boolean;
  onFeedback: ((useful: boolean, comment?: string) => Promise<void>) | null;
  summary: MeetingSummary | null;
  segments: Segment[];
  loading: boolean;
  selected: SummaryItem | null;
  onSelect: (item: SummaryItem) => void;
  onEdited: () => void;
  /** Failed notes: write them again (DESIGN §16 "Try again"). */
  onRetry: () => void;
  status: string;
}) {
  const numbers = useMemo(
    () => (summary === null ? new Map<string, number>() : numberCitations(summary)),
    [summary],
  );
  if (loading && summary === null)
    return (
      <Card className="notes">
        <SkeletonRows rows={5} />
      </Card>
    );
  // "Try again" after failed notes shows the same writing state, not the failed card with an
  // enabled button that could queue several rewrites (2026-11-09 audit).
  if (summary === null && (status === 'processing' || fading)) {
    // Notes are still being written; the Transcript tab (and video) can be used meanwhile.
    return (
      <Card className="processing">
        <span className="proc-dot" aria-hidden />
        <h2>Writing your notes…</h2>
        <p className="meta">
          This usually takes under a minute. You can leave this page — we&rsquo;ll let you know when
          they&rsquo;re ready. The transcript is ready now.
        </p>
      </Card>
    );
  }
  if (summary === null) {
    return (
      <Card className="notes">
        {status === 'failed' ? (
          <div className="notes-failed">
            <p className="empty">We couldn’t write notes for this meeting.</p>
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
            <p className="meta">The transcript is still available.</p>
          </div>
        ) : (
          <p className="empty">
            {status === 'too_short'
              ? 'This meeting was too short for notes.'
              : 'No notes for this meeting yet.'}
          </p>
        )}
      </Card>
    );
  }
  const bullet = (item: SummaryItem) => (
    <Bullet
      key={item.id}
      item={item}
      n={numbers.get(item.id)}
      selected={selected?.id === item.id}
      segments={segments}
      onSelect={() => onSelect(item)}
      onEdited={onEdited}
    />
  );
  return (
    <Card className={`notes ${fading ? 'fading' : ''}`}>
      <p className="legend">
        <span className="legend-item">
          <span className="swatch swatch-ink" aria-hidden /> You wrote this
        </span>
        <span className="legend-item">
          <span className="swatch swatch-muted" aria-hidden /> Added from the conversation
        </span>
        <span className="legend-item">
          <span className="cite cite-static" aria-hidden>
            1
          </span>{' '}
          Click to see who said it
        </span>
      </p>
      {summary.template === 'minutes' && meeting !== null ? (
        <MinutesView
          meeting={meeting}
          people={people}
          summary={summary}
          segments={segments}
          numbers={numbers}
          selected={selected}
          onSelect={onSelect}
          onEdited={onEdited}
        />
      ) : (
        <>
          <p className="overview">{summary.overview}</p>
          {summary.sections.map((section, i) => (
            <section key={section.note?.id ?? `topic-${i}`} className="note-section">
              <h2 className={section.note === null ? 'topic-heading' : 'note-heading'}>
                {section.note?.text ?? 'From the conversation'}
              </h2>
              <p className="meta small num">
                {section.note === null
                  ? 'added from the conversation'
                  : `your note · ${formatClock(section.note.sessionMs)}`}
              </p>
              {section.items.length === 0 ? (
                <p className="ai-line italic">Nothing in the conversation matched this note yet.</p>
              ) : (
                <ul className="bullets">{section.items.map(bullet)}</ul>
              )}
            </section>
          ))}
          {summary.decisions.length > 0 && (
            <section className="note-section">
              <h2 className="note-heading">Decisions</h2>
              <ul className="bullets decisions">{summary.decisions.map(bullet)}</ul>
            </section>
          )}
          {summary.questions.length > 0 && (
            <section className="note-section">
              <h2 className="note-heading">Open questions</h2>
              <ul className="bullets questions">{summary.questions.map(bullet)}</ul>
            </section>
          )}
        </>
      )}
      {onFeedback !== null && <NotesFeedback onSend={onFeedback} />}
    </Card>
  );
}
