import { newUlid } from '@meetyou/contracts';
import type { WorkspaceTx } from '@meetyou/db';
import type { LlmUsage } from '@meetyou/providers';
import type { TemplateId, ValidatedSummary } from '@meetyou/summarizer';

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
  if (input.accepted) {
    await tx
      .updateTable('summaries')
      .set({ accepted: false })
      .where('meetingId', '=', input.meetingId)
      .execute();
  }
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
      accepted: input.accepted,
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
