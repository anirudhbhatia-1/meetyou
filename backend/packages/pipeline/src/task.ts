import { TemplateId } from '@meetyou/contracts';
import type { Db } from '@meetyou/db';
import { createLogger, errorCode } from '@meetyou/log';
import { LlmHttpError, type LlmProvider } from '@meetyou/providers';
import { DEFAULT_MAX_ATTEMPTS, defineTask, enqueue, jobKey } from '@meetyou/queue';
import { GenerationFailedError, summarize, validateSummary } from '@meetyou/summarizer';
import { z } from 'zod';

import { nameLiveClusters } from './batch/naming.ts';
import { MIN_BATCH_MS, retranscribeJob, retranscribeJobKey } from './batch/task.ts';
import { ensureSelfParticipant, loadMeeting } from './meeting-data.ts';
import { storeFailedSummary, storeSummary } from './store.ts';

export const MEETING_SUMMARIZE = 'meeting.summarize';

/** IDs only (ADR-0005 §3.1). */
export const SummarizePayload = z.object({
  workspaceId: z.string().min(1),
  meetingId: z.string().min(1),
  /** session_end: first notes; regenerate: user asked (FR-SUM-07); batch: improved transcript (S3-04). */
  reason: z.enum(['session_end', 'regenerate', 'batch']),
  /** Regenerate with another template; otherwise the meeting's own. */
  template: TemplateId.optional(),
});
export type SummarizePayload = z.infer<typeof SummarizePayload>;

/** What services that only create the job need (gateway at the end of a recording, API). */
export const summarizeJob = {
  name: MEETING_SUMMARIZE,
  schema: SummarizePayload,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
} as const;

/** One pending run per meeting and reason: a repeated request replaces it. */
export function summarizeJobKey(meetingId: string, reason: SummarizePayload['reason']): string {
  return jobKey(MEETING_SUMMARIZE, meetingId, reason);
}

const log = createLogger('pipeline');

/**
 * The fast path (S3-03, ARCHITECTURE §9.3): summarizing → validating → stored version → ready.
 * `processing_step` tracks it for the progress stream (GET /v1/meetings/{id}/events). Failures the
 * model cannot fix by retrying mark the meeting failed visibly; vendor outages throw so the queue
 * retries with backoff. Without a configured model the meeting becomes ready without notes.
 */
export function summarizeTask(deps: {
  db: Db;
  llm: LlmProvider | null;
  /** Queue the batch pass after the first notes (S3-04); off unless a batch provider is set. */
  batch?: boolean;
}) {
  return defineTask(MEETING_SUMMARIZE, SummarizePayload, async (payload) => {
    const { workspaceId, meetingId, reason } = payload;
    const meeting = await deps.db.inWorkspace(workspaceId, async (tx) => {
      await ensureSelfParticipant(tx, workspaceId, meetingId);
      // Speaker names from Meet's signal before the first notes, so owners can be named (S3-04).
      if (reason === 'session_end') await nameLiveClusters(tx, meetingId);
      return loadMeeting(tx, workspaceId, meetingId);
    });
    if (meeting === null) return; // deleted meanwhile
    const template = payload.template ?? meeting.template;
    const setStep = (
      step: 'summarizing' | 'validating' | 'done' | null,
      status?: 'processing' | 'ready' | 'updated' | 'failed' | 'too_short',
    ) =>
      deps.db.inWorkspace(workspaceId, (tx) =>
        tx
          .updateTable('meetings')
          .set({ processingStep: step, ...(status !== undefined ? { status } : {}) })
          .where('id', '=', meetingId)
          .execute(),
      );

    // A regenerate leaves the meeting "ready": the old notes stay readable while the new run works.
    if (reason !== 'regenerate') await setStep('summarizing');
    const hasSpeech = meeting.data.segments.some((s) => !s.echo && s.text.trim() !== '');
    if (!hasSpeech) {
      await setStep('done', 'too_short');
      log.log('summary.skipped', { meetingId, reason: 'no_transcript' });
      return;
    }
    if (deps.llm === null) {
      await setStep('done', 'ready');
      log.log('summary.skipped', { meetingId, reason: 'no_llm' });
      return;
    }

    let run;
    try {
      run = await summarize(
        { ...meeting.data, template, language: meeting.summaryLanguage },
        deps.llm,
      );
    } catch (error) {
      const final =
        error instanceof GenerationFailedError ||
        (error instanceof LlmHttpError && !error.retryable);
      if (!final) throw error; // the queue retries outages with backoff
      await deps.db.inWorkspace(workspaceId, (tx) =>
        storeFailedSummary(tx, {
          workspaceId,
          meetingId,
          template,
          language: meeting.summaryLanguage,
          model: deps.llm?.model ?? 'unknown',
        }),
      );
      if (reason !== 'regenerate') await setStep(null, 'failed');
      log.error('summary.failed', { meetingId, code: errorCode(error) });
      return;
    }

    if (reason !== 'regenerate') await setStep('validating');
    const validated = validateSummary(run.output, {
      segments: meeting.data.segments,
      participants: meeting.data.participants,
      notes: meeting.data.notes,
      meetingDate: meeting.data.meeting.date,
    });
    const stored = await deps.db.inWorkspace(workspaceId, async (tx) => {
      const result = await storeSummary(tx, {
        workspaceId,
        meetingId,
        template,
        language: run.language,
        model: run.model,
        accepted: reason !== 'regenerate',
        summary: validated,
        usage: run.usage,
      });
      // The batch pass follows the first notes, if audio is kept long enough to re-read it (D-02).
      if (reason === 'session_end' && deps.batch === true) {
        const duration = (meeting.endedAt?.getTime() ?? 0) - meeting.startedAt.getTime();
        const settings = await tx
          .selectFrom('userSettings')
          .select('retentionPolicy')
          .limit(1)
          .executeTakeFirst();
        if (duration >= MIN_BATCH_MS && settings?.retentionPolicy !== 'immediate') {
          await enqueue(
            tx,
            retranscribeJob,
            { workspaceId, meetingId },
            { jobKey: retranscribeJobKey(meetingId) },
          );
        }
      }
      // An untitled meeting takes the summary's title; a name the user gave is never replaced.
      if (meeting.title === '' && validated.title !== '') {
        await tx
          .updateTable('meetings')
          .set({ title: validated.title.slice(0, 200) })
          .where('id', '=', meetingId)
          .execute();
      }
      return result;
    });
    if (reason !== 'regenerate') await setStep('done', reason === 'batch' ? 'updated' : 'ready');
    log.log('summary.stored', {
      meetingId,
      summaryId: stored.summaryId,
      count: validated.items.length,
      unverifiedCount: validated.report.unverified,
      inputTokenCount: run.usage.inputTokens,
      attempt: run.llmCalls,
    });
  });
}
