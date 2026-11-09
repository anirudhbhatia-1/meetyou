import {
  MEET_CHAT_NOTICE_ENABLED,
  notesFileName,
  notesText,
  type Meeting,
  type SummaryItem,
} from '@meetyou/contracts';
import { Banner, Button, Icon, SkeletonRows, useToast } from '@meetyou/ui';
import { useEffect, useRef, useState } from 'react';

import { useAnalytics } from '../lib/analytics.ts';
import { useApi } from '../lib/api-context.ts';
import { numberCitations } from '../lib/citations.ts';
import {
  formatLength,
  formatWhen,
  meetingTitle,
  recordingLabel,
  TEMPLATE_LABEL,
} from '../lib/format.ts';
import { saveTextFile, toNotesDoc } from '../lib/notes-doc.ts';
import { href, navigate, type DetailTab } from '../lib/router.ts';
import { useAsync } from '../lib/useAsync.ts';
import { AskTab, type AskCitation } from './AskTab.tsx';
import { ActionItemsCard, CitationCard } from './CitationRail.tsx';
import { ConsentLogSheet } from './ConsentLogSheet.tsx';
import { MoreMenu, useDeleteMeeting } from './MeetingMenu.tsx';
import { NotesTab } from './NotesTab.tsx';
import { ShareSheet } from './ShareSheet.tsx';
import { CandidateBanner, ImprovedBanner, TemplateMenu } from './SummaryControls.tsx';
import { TranscriptTab } from './TranscriptTab.tsx';

/** Finished meetings: their notes can be rewritten (a failed run included). */
const SETTLED: ReadonlySet<string> = new Set(['ready', 'updated', 'failed', 'too_short']);

const TAB_LABEL: Record<DetailTab, string> = {
  notes: 'Notes',
  transcript: 'Transcript',
  ask: 'Ask',
};

/** DESIGN §12 */
export function MeetingDetail({
  meetingId,
  tab,
  onActionsChanged,
}: {
  meetingId: string;
  tab: DetailTab;
  onActionsChanged: () => void;
}) {
  const api = useApi();
  const analytics = useAnalytics();
  const now = new Date();
  const meeting = useAsync(() => api.getMeeting(meetingId), [meetingId]);
  const summary = useAsync(() => api.getSummary(meetingId), [meetingId]);
  const segments = useAsync(() => api.getSegments(meetingId), [meetingId]);
  const people = useAsync(() => api.getParticipants(meetingId), [meetingId]);
  const [selected, setSelected] = useState<SummaryItem | null>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || tab !== 'notes' || summary.data == null) return;
    opened.current = true;
    analytics.track('summary_opened', { meetingId });
  }, [tab, summary.data, meetingId, analytics]);
  // An answer's citation (Ask tab); the newest pick, note or answer, fills the citation card.
  const [askCite, setAskCite] = useState<AskCitation | null>(null);
  const [playFrom, setPlayFrom] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [sheet, setSheet] = useState<'share' | 'consent' | null>(null);
  const rename = (value: string) => {
    setRenaming(false);
    const title = value.trim();
    if (title === '' || title === meeting.data?.title) return;
    api.renameMeeting(meetingId, title).then(
      () => {
        meeting.reload();
        toast({ message: 'Renamed' });
      },
      () => toast({ message: 'Couldn’t rename the meeting. Try again.' }),
    );
  };
  const remove = useDeleteMeeting({
    deleted: () => navigate({ screen: 'meetings' }),
    restored: (id) => navigate({ screen: 'detail', meetingId: id, tab: 'notes' }),
  });
  const toast = useToast();
  // Template being rewritten (DESIGN §12.2); the notes fade until the new version arrives.
  const [rewriting, setRewriting] = useState<Meeting['template'] | null>(null);

  // S3-03: while the notes are being written, follow progress and refresh once they are ready.
  const status = meeting.data?.status;
  useEffect(() => {
    if (status !== 'processing') return undefined;
    return api.watchProgress(meetingId, (p) => {
      if (p.status !== 'processing') {
        meeting.reload();
        summary.reload();
        people.reload();
      }
    });
    // Reload functions change identity each render; status and meeting decide when to follow.
  }, [status, meetingId]);

  // Regenerate: look for the candidate every 3 s, give up after 2 minutes. After a failed first
  // run there are no notes to compare with, so the rewrite arrives as the notes themselves.
  const candidate = summary.data?.candidate ?? null;
  const shownVersion = summary.data?.version ?? null;
  const [rewriteFrom, setRewriteFrom] = useState<number | null>(null);
  useEffect(() => {
    if (rewriting === null) return undefined;
    if (candidate !== null || (summary.data != null && shownVersion !== rewriteFrom)) {
      setRewriting(null);
      if (candidate === null) meeting.reload();
      return undefined;
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 120_000) {
        setRewriting(null);
        toast({ message: 'Couldn’t rewrite the notes. Try again.' });
        return;
      }
      summary.reload();
    }, 3_000);
    return () => clearInterval(timer);
  }, [rewriting, candidate, shownVersion]);

  const m = meeting.data;
  if (meeting.loading && m === undefined) {
    return (
      <div className="page">
        <SkeletonRows rows={4} />
      </div>
    );
  }
  if (m === null || m === undefined) {
    return (
      <div className="page">
        <Banner tone="error">
          {m === undefined && meeting.error
            ? 'Couldn’t load this meeting. Check your connection and try again.'
            : 'This meeting was not found. It may have been deleted.'}
        </Banner>
        {m === undefined && meeting.error && (
          <Button variant="ghost" onClick={meeting.reload}>
            Try again
          </Button>
        )}
        <Button variant="ghost" onClick={() => navigate({ screen: 'meetings' })}>
          Back to Meetings
        </Button>
      </div>
    );
  }

  const rec = recordingLabel(m.recordingExpiresAt, now);
  return (
    <div className="detail">
      {remove.alert}
      <div className="toolbar glass-bar">
        <Button variant="ghost" onClick={() => navigate({ screen: 'meetings' })}>
          <Icon name="chevron-left" /> Meetings
        </Button>
        <span className="toolbar-title">{meetingTitle(m)}</span>
        <div className="toolbar-actions">
          <TemplateMenu
            current={summary.data?.template ?? m.template}
            disabled={
              !SETTLED.has(m.status) || summary.loading || rewriting !== null || candidate !== null
            }
            onPick={(template) => {
              void api
                .regenerateSummary(meetingId, template)
                .then(() => {
                  setRewriteFrom(shownVersion);
                  setRewriting(template);
                })
                .catch(() => toast({ message: 'Couldn’t rewrite the notes. Try again.' }));
            }}
          />
          <Button
            variant="primary"
            aria-label="Share notes"
            disabled={summary.data == null}
            title={summary.data == null ? 'Available once the notes are ready' : undefined}
            onClick={() => setSheet('share')}
          >
            <Icon name="share" /> <span className="hide-sm">Share</span>
          </Button>
          <MoreMenu
            onDelete={() => remove.request(meetingId)}
            onRename={() => setRenaming(true)}
            {...(MEET_CHAT_NOTICE_ENABLED ? { onConsentLog: () => setSheet('consent') } : {})}
            {...(summary.data != null
              ? {
                  onDownload: () => {
                    const notes = summary.data;
                    if (notes == null) return;
                    const doc = toNotesDoc(m, notes, segments.data ?? [], people.data ?? []);
                    saveTextFile(
                      notesFileName(meetingTitle(m), m.startedAt, 'md'),
                      notesText(doc, { format: 'markdown', includeTimes: true }),
                    );
                    analytics.track('notes_shared', {
                      meetingId,
                      action: 'download',
                      format: 'markdown',
                    });
                  },
                }
              : {})}
          />
        </div>
      </div>
      <div className="page detail-page">
        <header>
          <p className="meta">
            {formatWhen(m.startedAt, now)} · {formatLength(m.startedAt, m.endedAt)} ·{' '}
            {m.participantNames.length === 0 ? 'You' : `${m.participantNames.join(', ')} and you`}
            {rec !== null && ` · ${rec}`}
          </p>
          {renaming ? (
            <input
              className="meeting-title meeting-title-input"
              aria-label="Meeting name"
              autoFocus
              defaultValue={m.title}
              maxLength={200}
              onBlur={(e) => rename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <h1
              className="meeting-title"
              title="Double-click to rename"
              onDoubleClick={() => setRenaming(true)}
            >
              {meetingTitle(m)}
            </h1>
          )}
        </header>
        {sheet === 'share' && summary.data != null && (
          <ShareSheet
            meeting={m}
            summary={summary.data}
            segments={segments.data ?? []}
            people={people.data ?? []}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === 'consent' && <ConsentLogSheet meeting={m} onClose={() => setSheet(null)} />}
        <>
          <div className="tabs" role="tablist" aria-label="Meeting">
            {(m.status === 'recording'
              ? (['notes', 'transcript'] as const)
              : (['notes', 'transcript', 'ask'] as const)
            ).map((t) => (
              <a
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`tab ${tab === t ? 'tab-on' : ''}`}
                href={href({ screen: 'detail', meetingId, tab: t })}
              >
                {TAB_LABEL[t]}
              </a>
            ))}
          </div>
          {m.status === 'updated' && (
            <ImprovedBanner
              meetingId={meetingId}
              onSeeChanges={() => navigate({ screen: 'detail', meetingId, tab: 'transcript' })}
            />
          )}
          {candidate !== null && tab === 'notes' && (
            <CandidateBanner
              onKeep={() =>
                api.keepSummary(meetingId, candidate.version).then(
                  () => {
                    summary.reload();
                    toast({ message: `Rewritten as ${TEMPLATE_LABEL[candidate.template]} notes` });
                  },
                  () => toast({ message: 'Couldn’t keep the new version. Try again.' }),
                )
              }
              onGoBack={() =>
                api.discardSummary(meetingId, candidate.version).then(
                  () => summary.reload(),
                  () => toast({ message: 'Couldn’t go back. Try again.' }),
                )
              }
            />
          )}
          <div className="detail-grid">
            {tab === 'notes' && (
              <NotesTab
                fading={rewriting !== null}
                onFeedback={
                  summary.data?.summaryId === undefined
                    ? null
                    : (useful, comment) => {
                        analytics.track('summary_feedback', { meetingId, useful });
                        return api.sendFeedback(summary.data?.summaryId ?? '', useful, comment);
                      }
                }
                summary={summary.data ?? null}
                segments={segments.data ?? []}
                loading={summary.loading}
                selected={selected}
                onSelect={(item) => {
                  setSelected(item);
                  setAskCite(null);
                  analytics.track('citation_opened', { meetingId });
                }}
                onEdited={() => {
                  summary.reload();
                  onActionsChanged();
                }}
                onRetry={() => {
                  void api
                    .regenerateSummary(meetingId, m.template)
                    .then(() => {
                      setRewriteFrom(shownVersion);
                      setRewriting(m.template);
                    })
                    .catch(() => toast({ message: 'Couldn’t start. Try again.' }));
                }}
                status={m.status}
              />
            )}
            {tab === 'transcript' && (
              <TranscriptTab
                meetingId={meetingId}
                segments={segments.data ?? []}
                people={people.data ?? []}
                loading={segments.loading}
                video={m.video}
                highlightIds={askCite?.segmentIds ?? selected?.segmentIds ?? []}
                startAt={playFrom}
                onSpeakerRenamed={() => {
                  segments.reload();
                  people.reload();
                  meeting.reload();
                }}
              />
            )}
            {tab === 'ask' && m.status !== 'recording' && (
              <AskTab
                meetingId={meetingId}
                selected={askCite}
                onSelect={(cite) => {
                  setAskCite(cite);
                  setSelected(null);
                }}
              />
            )}
            <aside className="rail">
              <CitationCard
                meeting={m}
                item={askCite ?? selected}
                number={
                  askCite !== null
                    ? askCite.number
                    : selected === null || summary.data == null
                      ? null
                      : (numberCitations(summary.data).get(selected.id) ?? null)
                }
                segments={segments.data ?? []}
                onShowInTranscript={(continueAt) => {
                  if (continueAt !== null) setPlayFrom(continueAt);
                  navigate({ screen: 'detail', meetingId, tab: 'transcript' });
                }}
              />
              <ActionItemsCard
                summary={summary.data ?? null}
                people={people.data ?? []}
                onChanged={onActionsChanged}
              />
            </aside>
          </div>
        </>
      </div>
    </div>
  );
}
