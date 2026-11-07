import {
  ASK_LIMITS,
  ASK_NOT_FOUND_TEXT,
  ASK_OFF_TOPIC_TEXT,
  type AskUsage,
  type MeetingQuestion,
} from '@meetyou/contracts';
import { Banner, Button, Card, CitationChip, SkeletonRows } from '@meetyou/ui';
import { useState, type KeyboardEvent } from 'react';

import type { AskResult } from '../api/types.ts';
import { useApi } from '../lib/api-context.ts';
import { useAsync } from '../lib/useAsync.ts';

/** A pinned answer citation, shown in the rail's citation card (DESIGN §12.6). */
export interface AskCitation {
  key: string;
  segmentIds: string[];
  number: number;
}

const ERROR_TEXT: Record<Exclude<AskResult, { ok: true }>['error'], string | null> = {
  rate_limited: null,
  unavailable: 'Answers aren’t available right now. Try again later.',
  no_transcript: 'This recording has no transcript yet.',
  failed: 'Couldn’t answer that. Try again.',
};

/**
 * DESIGN §12.7 "Ask this meeting": questions about this recording only, answered from it, visible
 * to its owner only (the API enforces scope, citations and limits; refusals are fixed texts).
 */
export function AskTab({
  meetingId,
  selected,
  onSelect,
}: {
  meetingId: string;
  selected: AskCitation | null;
  onSelect: (citation: AskCitation) => void;
}) {
  const api = useApi();
  const history = useAsync(() => api.listQuestions(meetingId), [meetingId]);
  const [asked, setAsked] = useState<MeetingQuestion[]>([]);
  const [latestUsage, setLatestUsage] = useState<AskUsage | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = [...(history.data?.items ?? []), ...asked];
  const usage = latestUsage ?? history.data?.usage ?? null;
  const limited =
    usage !== null && (usage.usedLastHour >= usage.perHour || usage.usedLastDay >= usage.perDay);
  const length = draft.trim().length;
  const over = length > ASK_LIMITS.questionChars;
  const canSend = length > 0 && !over && pending === null && !limited;

  const send = async () => {
    if (!canSend) return;
    const question = draft.trim();
    setPending(question);
    setError(null);
    const result: AskResult = await api
      .askQuestion(meetingId, question)
      .catch(() => ({ ok: false, error: 'failed' }) as const);
    setPending(null);
    if (result.ok) {
      setAsked((list) => [...list, result.question]);
      setLatestUsage(result.usage);
      setDraft('');
      return;
    }
    if (result.error === 'rate_limited' && usage !== null) {
      setLatestUsage({ ...usage, usedLastHour: usage.perHour });
    }
    setError(ERROR_TEXT[result.error]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <Card className="ask">
      <p className="meta">
        Ask about this recording. Answers come only from what was said in it. Only you can see your
        questions.
      </p>
      {history.loading && history.data === undefined ? (
        <SkeletonRows rows={2} />
      ) : (
        <ol className="ask-history">
          {items.length === 0 && pending === null && (
            <li className="meta">For example: What did we decide about pricing?</li>
          )}
          {items.map((q) => (
            <li key={q.id}>
              <p className="ask-q">{q.question}</p>
              {q.status === 'answered' ? (
                <p className="ask-a">
                  {q.answer}{' '}
                  {q.citations.length === 0 && (
                    <span className="meta small ask-source">From the meeting details</span>
                  )}
                  {q.citations.map((c, i) => {
                    const key = `${q.id}:${i}`;
                    return (
                      <CitationChip
                        key={key}
                        n={i + 1}
                        selected={selected?.key === key}
                        onSelect={() => onSelect({ key, segmentIds: [c.segmentId], number: i + 1 })}
                      />
                    );
                  })}
                </p>
              ) : (
                <p className="ask-a italic">
                  {q.status === 'off_topic' ? ASK_OFF_TOPIC_TEXT : ASK_NOT_FOUND_TEXT}
                </p>
              )}
            </li>
          ))}
          {pending !== null && (
            <li>
              <p className="ask-q">{pending}</p>
              <p className="ask-a ask-waiting">
                <span className="proc-dot" aria-hidden /> Reading the recording…
              </p>
            </li>
          )}
        </ol>
      )}
      {limited && (
        <Banner tone="warning">You’ve reached the question limit. Try again in an hour.</Banner>
      )}
      {error !== null && <Banner tone="error">{error}</Banner>}
      <div className="ask-composer">
        <textarea
          aria-label="Question about this meeting"
          placeholder="Ask a question about this meeting"
          value={draft}
          disabled={pending !== null || limited}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="ask-row">
          <span className={`meta small num ${over ? 'ask-over' : ''}`}>
            {length} / {ASK_LIMITS.questionChars}
          </span>
          <Button variant="primary" disabled={!canSend} onClick={() => void send()}>
            Ask
          </Button>
        </div>
        {usage !== null && (
          <p className="meta small">
            {usage.usedLastHour} of {usage.perHour} questions this hour
          </p>
        )}
      </div>
    </Card>
  );
}
