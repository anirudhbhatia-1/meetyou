import { newUlid } from '@meetyou/contracts';
import type { Db } from '@meetyou/db';
import { createLogger, errorCode } from '@meetyou/log';
import { LlmHttpError, type LlmProvider } from '@meetyou/providers';
import { DEFAULT_MAX_ATTEMPTS, defineTask, jobKey } from '@meetyou/queue';
import { GenerationFailedError, suggestFolder, type FolderCandidate } from '@meetyou/summarizer';
import { z } from 'zod';

export const MEETING_SUGGEST_FOLDER = 'meeting.suggest_folder';

/** IDs only (ADR-0005 §3.1). */
export const SuggestFolderPayload = z.object({
  workspaceId: z.string().min(1),
  meetingId: z.string().min(1),
});

export const suggestFolderJob = {
  name: MEETING_SUGGEST_FOLDER,
  schema: SuggestFolderPayload,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
} as const;

export function suggestFolderJobKey(meetingId: string): string {
  return jobKey(MEETING_SUGGEST_FOLDER, meetingId, 1);
}

const EXAMPLES_PER_FOLDER = 4;
const log = createLogger('pipeline');

/**
 * DESIGN §11.2: after the first notes, suggest one existing folder for an unfiled meeting. Runs
 * once per meeting (`folder_suggestion` records the outcome); a user who filed the meeting or has
 * no folders meanwhile gets nothing. Vendor outages throw so the queue retries; anything else
 * settles as "none" — a missing suggestion is never an error the user sees.
 */
export function suggestFolderTask(deps: { db: Db; llm: LlmProvider | null }) {
  return defineTask(
    MEETING_SUGGEST_FOLDER,
    SuggestFolderPayload,
    async ({ workspaceId, meetingId }) => {
      const llm = deps.llm;
      if (llm === null) return;
      const input = await deps.db.inWorkspace(workspaceId, async (tx) => {
        const meeting = await tx
          .selectFrom('meetings')
          .select(['title', 'status', 'folderId', 'folderSuggestion'])
          .where('id', '=', meetingId)
          .where('deletedAt', 'is', null)
          .executeTakeFirst();
        if (
          meeting === undefined ||
          meeting.folderId !== null ||
          meeting.folderSuggestion !== null ||
          !['ready', 'updated'].includes(meeting.status)
        ) {
          return null;
        }
        const folders = await tx.selectFrom('folders').select(['id', 'name']).execute();
        if (folders.length === 0) return null;
        const filed = await tx
          .selectFrom('meetings')
          .select(['folderId', 'title'])
          .where('folderId', 'is not', null)
          .where('deletedAt', 'is', null)
          .where('title', '<>', '')
          .orderBy('startedAt', 'desc')
          .limit(500)
          .execute();
        const candidates: FolderCandidate[] = folders.map((f) => ({
          id: f.id,
          name: f.name,
          examples: filed
            .filter((m) => m.folderId === f.id)
            .slice(0, EXAMPLES_PER_FOLDER)
            .map((m) => m.title),
        }));
        const summary = await tx
          .selectFrom('summaries')
          .select('overview')
          .where('meetingId', '=', meetingId)
          .where('accepted', '=', true)
          .orderBy('version', 'desc')
          .executeTakeFirst();
        const people = await tx
          .selectFrom('participants')
          .select('displayName')
          .where('meetingId', '=', meetingId)
          .where('isSelf', '=', false)
          .execute();
        return {
          folders: candidates,
          meeting: {
            title: meeting.title,
            people: people.map((p) => p.displayName),
            overview: summary?.overview ?? '',
          },
        };
      });
      if (input === null) return;

      let folderId: string | null = null;
      let usage: Awaited<ReturnType<typeof suggestFolder>> | null = null;
      try {
        usage = await suggestFolder(input, llm);
        folderId = usage.folderId;
      } catch (error) {
        if (error instanceof LlmHttpError && error.retryable) throw error; // the queue retries
        if (!(error instanceof GenerationFailedError) && !(error instanceof LlmHttpError))
          throw error;
        log.error('folder.suggest_failed', { meetingId, code: errorCode(error) });
      }

      await deps.db.inWorkspace(workspaceId, async (tx) => {
        // Only if nothing changed meanwhile: a move or a dismissal by the user wins.
        await tx
          .updateTable('meetings')
          .set({
            suggestedFolderId: folderId,
            folderSuggestion: folderId === null ? 'none' : 'suggested',
          })
          .where('id', '=', meetingId)
          .where('folderId', 'is', null)
          .where('folderSuggestion', 'is', null)
          .execute();
        if (usage === null) return;
        // Cost per meeting (AGENTS §3 rule 10); thinking is billed as output.
        await tx
          .insertInto('usageRecords')
          .values({
            id: `use_fld_${newUlid()}`,
            workspaceId,
            meetingId,
            sttProvider: null,
            llmModel: usage.model,
            inputTokens: usage.usage.inputTokens,
            outputTokens: usage.usage.outputTokens + usage.usage.thinkingTokens,
          })
          .execute();
      });
      log.log('folder.suggested', { meetingId, suggested: folderId !== null });
    },
  );
}
