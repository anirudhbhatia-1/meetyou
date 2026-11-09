import { newUlid } from '@meetyou/contracts';
import type { WorkspaceTx } from '@meetyou/db';
import type { LlmUsage } from '@meetyou/providers';
import type { TemplateId, ValidatedSummary } from '@meetyou/summarizer';

import { textSimilarity } from './batch/align.ts';

/**
 * Summary versions (ARCHITECTURE §10.2 step 7, FR-SUM-07): every run adds a version; a regenerated
 * version waits as a candidate until the user keeps it, so the notes they were reading never change
 * under them. Items, citations and the LLM usage row are written in the same transaction.
 */
export interface StoreSummaryInput {
  workspaceId: string;
  meetingId: string;
  template: TemplateId;
  language: string;
  model: string;
  /** False for regenerated versions (keep / go back); true for the first and the batch pass. */
  accepted: boolean;
  summary: ValidatedSummary;
  usage: LlmUsage;
}

async function nextVersion(tx: WorkspaceTx, meetingId: string): Promise<number> {
  const row = await tx
    .selectFrom('summaries')
    .select((eb) => eb.fn.max('version').as('max'))
    .where('meetingId', '=', meetingId)
    .executeTakeFirst();
  return Number(row?.max ?? 0) + 1;
}

export async function storeSummary(
  tx: WorkspaceTx,
  input: StoreSummaryInput,
): Promise<{ summaryId: string; version: number }> {
  const summaryId = `sum_${newUlid()}`;
  const version = await nextVersion(tx, input.meetingId);
  // Inserted unaccepted; `acceptSummary` below switches over once its items exist.
  await tx
    .insertInto('summaries')
    .values({
      id: summaryId,
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      version,
      template: input.template,
      language: input.language,
      model: input.model,
      status: 'ready',
      overview: input.summary.overview,
      accepted: false,
    })
    .execute();
  for (const item of input.summary.items) {
    const itemId = `sit_${newUlid()}`;
    await tx
      .insertInto('summaryItems')
      .values({
        id: itemId,
        workspaceId: input.workspaceId,
        meetingId: input.meetingId,
        summaryId,
        kind: item.kind,
        text: item.text,
        anchorNoteId: item.anchorNoteId,
        ownerParticipantId: item.ownerParticipantId,
        dueDate: item.dueDate,
        duePhrase: item.duePhrase,
        status: item.kind === 'action_item' ? 'open' : null,
        flagged: item.flagged,
        order: item.order,
      })
      .execute();
    for (const segmentId of item.segmentIds) {
      await tx
        .insertInto('citations')
        .values({
          id: `cit_${newUlid()}`,
          workspaceId: input.workspaceId,
          meetingId: input.meetingId,
          summaryItemId: itemId,
          segmentId,
        })
        .execute();
    }
  }
  if (input.accepted) await acceptSummary(tx, input.meetingId, summaryId);
  // Cost per meeting (AGENTS §3 rule 10): one row per summary version; thinking is billed as output.
  await tx
    .insertInto('usageRecords')
    .values({
      id: `use_sum_${summaryId}`,
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      sttProvider: null,
      llmModel: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens + input.usage.thinkingTokens,
    })
    .execute();
  return { summaryId, version };
}

/** A run that produced nothing usable: recorded as a failed version, so the UI can say so. */
export async function storeFailedSummary(
  tx: WorkspaceTx,
  input: Pick<StoreSummaryInput, 'workspaceId' | 'meetingId' | 'template' | 'language' | 'model'>,
): Promise<void> {
  await tx
    .insertInto('summaries')
    .values({
      id: `sum_${newUlid()}`,
      workspaceId: input.workspaceId,
      meetingId: input.meetingId,
      version: await nextVersion(tx, input.meetingId),
      template: input.template,
      language: input.language,
      model: input.model,
      status: 'failed',
      overview: null,
      accepted: false,
    })
    .execute();
}

/** Reworded action items still count as the same task at this similarity (and a compatible owner). */
const SAME_TASK = 0.6;

/**
 * Makes `summaryId` the notes the user reads (first run, batch pass, or Keep after a rewrite) and
 * carries done/open over from the version it replaces (ARCHITECTURE §9.3): each new action item
 * takes the status of the most similar old one with a compatible owner, so ticking an item off
 * survives regeneration.
 */
export async function acceptSummary(
  tx: WorkspaceTx,
  meetingId: string,
  summaryId: string,
): Promise<void> {
  const previous = await tx
    .selectFrom('summaries')
    .select('id')
    .where('meetingId', '=', meetingId)
    .where('accepted', '=', true)
    .where('id', '<>', summaryId)
    .executeTakeFirst();
  await tx
    .updateTable('summaries')
    .set({ accepted: false })
    .where('meetingId', '=', meetingId)
    .execute();
  await tx.updateTable('summaries').set({ accepted: true }).where('id', '=', summaryId).execute();
  if (previous === undefined) return;

  const actions = (id: string) =>
    tx
      .selectFrom('summaryItems')
      .select(['id', 'text', 'ownerParticipantId', 'status', 'completedAt'])
      .where('summaryId', '=', id)
      .where('kind', '=', 'action_item')
      .orderBy('order')
      .execute();
  const before = (await actions(previous.id)).filter((a) => a.status === 'done');
  const used = new Set<string>();
  for (const item of await actions(summaryId)) {
    let best: (typeof before)[number] | undefined;
    let bestScore = SAME_TASK;
    for (const old of before) {
      if (used.has(old.id)) continue;
      const owners =
        old.ownerParticipantId === null ||
        item.ownerParticipantId === null ||
        old.ownerParticipantId === item.ownerParticipantId;
      const score = textSimilarity(old.text, item.text);
      if (owners && score >= bestScore) {
        best = old;
        bestScore = score;
      }
    }
    if (best === undefined) continue;
    used.add(best.id);
    await tx
      .updateTable('summaryItems')
      .set({ status: 'done', completedAt: best.completedAt ?? new Date() })
      .where('id', '=', item.id)
      .execute();
  }
}
