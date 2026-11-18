import { newUlid } from '@meetyou/contracts';
import { createMeetingForSession, endMeeting } from '@meetyou/db';
import { createTestDb } from '@meetyou/db/testing';
import { LlmHttpError, type LlmProvider } from '@meetyou/providers';
import type { JobHelpers } from 'graphile-worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { suggestFolderTask } from './folder-task.ts';

/** DESIGN §11.2 on PGlite with RLS: one suggestion per meeting, never over the user's choice. */
describe('meeting.suggest_folder', () => {
  let env: Awaited<ReturnType<typeof createTestDb>>;
  let workspaceId = '';
  const helpers = { job: { attempts: 1, max_attempts: 8 } } as unknown as JobHelpers;
  const sales = `fld_${newUlid()}`;

  beforeAll(async () => {
    env = await createTestDb();
    const account = await env.db.signInGoogleUser(
      { googleSub: 'fold', email: 'fold@example.com', displayName: 'Fold' },
      {
        userId: `usr_${newUlid()}`,
        workspaceId: `ws_${newUlid()}`,
        membershipId: `mem_${newUlid()}`,
        settingsId: `set_${newUlid()}`,
      },
    );
    workspaceId = account.workspaceId ?? '';
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx
        .insertInto('folders')
        .values([
          { id: sales, workspaceId, name: 'Sales', createdBy: null },
          { id: `fld_${newUlid()}`, workspaceId, name: 'Hiring', createdBy: null },
        ])
        .execute(),
    );
  }, 60_000);

  afterAll(async () => {
    await env.close();
  });

  async function readyMeeting(title: string): Promise<string> {
    const meetingId = `mtg_${newUlid()}`;
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: 'abc-defg-hij',
        startedAt: new Date('2026-11-17T04:30:00Z'),
      });
      await endMeeting(tx, meetingId, new Date('2026-11-17T04:40:00Z'));
      await tx
        .updateTable('meetings')
        .set({ title, status: 'ready' })
        .where('id', '=', meetingId)
        .execute();
    });
    return meetingId;
  }

  const llm = (answer: unknown | Error, inputs: string[] = []): LlmProvider => ({
    name: 'fake',
    model: 'fake-model',
    generateStructured(request) {
      inputs.push(request.input);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({
        json: answer,
        usage: { inputTokens: 200, outputTokens: 10, thinkingTokens: 5 },
        model: 'fake-model-001',
      });
    },
  });

  const read = (meetingId: string) =>
    env.db.inWorkspace(workspaceId, async (tx) => ({
      meeting: await tx
        .selectFrom('meetings')
        .select(['folderId', 'suggestedFolderId', 'folderSuggestion'])
        .where('id', '=', meetingId)
        .executeTakeFirstOrThrow(),
      usage: await tx
        .selectFrom('usageRecords')
        .select(['llmModel', 'inputTokens', 'outputTokens'])
        .where('meetingId', '=', meetingId)
        .execute(),
    }));

  it('suggests a listed folder, with examples in the prompt, and records the cost', async () => {
    const filed = await readyMeeting('Acme renewal');
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx.updateTable('meetings').set({ folderId: sales }).where('id', '=', filed).execute(),
    );
    const meetingId = await readyMeeting('Acme follow-up');
    const inputs: string[] = [];
    await suggestFolderTask({
      db: env.db,
      llm: llm({ folder: 'Sales', confidence: 0.9 }, inputs),
    }).handle({ workspaceId, meetingId }, helpers);
    expect(inputs[0]).toContain('Acme renewal');
    expect(await read(meetingId)).toEqual({
      meeting: { folderId: null, suggestedFolderId: sales, folderSuggestion: 'suggested' },
      usage: [{ llmModel: 'fake-model-001', inputTokens: 200, outputTokens: 15 }],
    });
    // Runs once: a second job changes nothing and calls no model.
    const again: string[] = [];
    await suggestFolderTask({
      db: env.db,
      llm: llm({ folder: 'Hiring', confidence: 1 }, again),
    }).handle({ workspaceId, meetingId }, helpers);
    expect(again).toEqual([]);
  });

  it('settles as none when unsure, and never touches a filed meeting', async () => {
    const unsure = await readyMeeting('Random chat');
    await suggestFolderTask({ db: env.db, llm: llm({ folder: 'Sales', confidence: 0.4 }) }).handle(
      { workspaceId, meetingId: unsure },
      helpers,
    );
    expect((await read(unsure)).meeting.folderSuggestion).toBe('none');

    const filed = await readyMeeting('Already filed');
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx.updateTable('meetings').set({ folderId: sales }).where('id', '=', filed).execute(),
    );
    const calls: string[] = [];
    await suggestFolderTask({
      db: env.db,
      llm: llm({ folder: 'Sales', confidence: 1 }, calls),
    }).handle({ workspaceId, meetingId: filed }, helpers);
    expect(calls).toEqual([]);
    expect((await read(filed)).meeting.folderSuggestion).toBeNull();
  });

  it('lets the queue retry an outage', async () => {
    const meetingId = await readyMeeting('Outage');
    await expect(
      suggestFolderTask({ db: env.db, llm: llm(new LlmHttpError(503)) }).handle(
        { workspaceId, meetingId },
        helpers,
      ),
    ).rejects.toThrow(LlmHttpError);
    expect((await read(meetingId)).meeting.folderSuggestion).toBeNull();
  });
});
