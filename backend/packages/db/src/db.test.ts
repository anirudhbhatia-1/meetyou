import { newUlid } from '@meetyou/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db, NewAccountIds } from './db.ts';
import { migrate } from './migrate.ts';
import { createTestDb, pgliteRunner } from './testing.ts';

let env: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  env = await createTestDb();
});

afterEach(async () => {
  await env.close();
});

const id = (prefix: string) => `${prefix}_${newUlid()}`;

function accountIds(): NewAccountIds {
  return {
    userId: id('usr'),
    workspaceId: id('ws'),
    membershipId: id('mem'),
    settingsId: id('set'),
  };
}

async function signIn(db: Db, sub: string) {
  return db.signInGoogleUser(
    { googleSub: sub, email: `${sub}@example.com`, displayName: `User ${sub}` },
    accountIds(),
  );
}

async function addMeeting(db: Db, workspaceId: string): Promise<string> {
  const meetingId = id('mtg');
  await db.inWorkspace(workspaceId, (tx) =>
    tx
      .insertInto('meetings')
      .values({
        id: meetingId,
        workspaceId,
        sessionId: id('ses'),
        platform: 'google_meet',
        startedAt: new Date('2026-11-05T10:00:00Z'),
      })
      .execute(),
  );
  return meetingId;
}

describe('migrations', () => {
  it('apply once and are skipped on the next run', async () => {
    expect(await migrate(pgliteRunner(env.pg))).toEqual([]);
    const { rows } = await env.pg.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    expect(rows.map((r) => r.version)).toEqual(['0001']);
  });
});

describe('sign-in bootstrap (ADR-0004)', () => {
  it('creates a user with a personal workspace and default settings, once', async () => {
    const first = await signIn(env.db, 'g-1');
    expect(first.created).toBe(true);
    const again = await signIn(env.db, 'g-1');
    expect(again).toEqual({ ...first, created: false });

    const settings = await env.db.inWorkspace(first.workspaceId, (tx) =>
      tx.selectFrom('userSettings').selectAll().execute(),
    );
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({ retentionPolicy: '7d', recordVideo: true });

    const other = await signIn(env.db, 'g-2');
    expect(other.workspaceId).not.toBe(first.workspaceId);
  });
});

describe('tenancy enforcement (ARCHITECTURE §11.3)', () => {
  it('shows a workspace only its own rows', async () => {
    const a = await signIn(env.db, 'a');
    const b = await signIn(env.db, 'b');
    const meetingA = await addMeeting(env.db, a.workspaceId);
    await addMeeting(env.db, b.workspaceId);

    const seenByA = await env.db.inWorkspace(a.workspaceId, (tx) =>
      tx.selectFrom('meetings').select('id').execute(),
    );
    expect(seenByA.map((m) => m.id)).toEqual([meetingA]);
    const workspacesSeenByA = await env.db.inWorkspace(a.workspaceId, (tx) =>
      tx.selectFrom('workspaces').select('id').execute(),
    );
    expect(workspacesSeenByA.map((w) => w.id)).toEqual([a.workspaceId]);
  });

  it('refuses writes into another workspace', async () => {
    const a = await signIn(env.db, 'a');
    const b = await signIn(env.db, 'b');
    await expect(
      env.db.inWorkspace(a.workspaceId, (tx) =>
        tx
          .insertInto('meetings')
          .values({
            id: id('mtg'),
            workspaceId: b.workspaceId,
            sessionId: id('ses'),
            platform: 'google_meet',
            startedAt: new Date(),
          })
          .execute(),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot attach a row to another workspace’s meeting', async () => {
    const a = await signIn(env.db, 'a');
    const b = await signIn(env.db, 'b');
    const meetingB = await addMeeting(env.db, b.workspaceId);
    await expect(
      env.db.inWorkspace(a.workspaceId, (tx) =>
        tx
          .insertInto('notes')
          .values({
            id: id('note'),
            workspaceId: a.workspaceId,
            meetingId: meetingB,
            text: 'follow up',
            sessionMs: 1000,
          })
          .execute(),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('cannot update or delete another workspace’s rows', async () => {
    const a = await signIn(env.db, 'a');
    const b = await signIn(env.db, 'b');
    const meetingB = await addMeeting(env.db, b.workspaceId);
    const updated = await env.db.inWorkspace(a.workspaceId, (tx) =>
      tx.updateTable('meetings').set({ title: 'x' }).where('id', '=', meetingB).executeTakeFirst(),
    );
    expect(updated.numUpdatedRows).toBe(0n);
    const deleted = await env.db.inWorkspace(a.workspaceId, (tx) =>
      tx.deleteFrom('meetings').where('id', '=', meetingB).executeTakeFirst(),
    );
    expect(deleted.numDeletedRows).toBe(0n);
    const stillThere = await env.db.inWorkspace(b.workspaceId, (tx) =>
      tx.selectFrom('meetings').select('title').where('id', '=', meetingB).executeTakeFirst(),
    );
    expect(stillThere?.title).toBe('');
  });

  it('sees nothing without a workspace, and the setting does not outlive its transaction', async () => {
    const a = await signIn(env.db, 'a');
    await addMeeting(env.db, a.workspaceId);
    const { rows } = await env.pg.query('SELECT id FROM meetings');
    expect(rows).toEqual([]);
    const users = await env.pg.query('SELECT id FROM users');
    expect(users.rows).toEqual([]);
  });

  it('rejects a malformed workspace id before touching the database', async () => {
    await expect(env.db.inWorkspace("ws_x' or '1'='1", async () => 1)).rejects.toThrow(
      'invalid workspace id',
    );
  });
});

describe('schema rules', () => {
  it('keeps open/done status for action items only', async () => {
    const a = await signIn(env.db, 'a');
    const meetingId = await addMeeting(env.db, a.workspaceId);
    const summaryId = id('sum');
    await env.db.inWorkspace(a.workspaceId, async (tx) => {
      await tx
        .insertInto('summaries')
        .values({
          id: summaryId,
          workspaceId: a.workspaceId,
          meetingId,
          version: 1,
          template: 'general',
          language: 'en',
          model: 'test',
          status: 'ready',
        })
        .execute();
      await tx
        .insertInto('summaryItems')
        .values({
          id: id('itm'),
          workspaceId: a.workspaceId,
          summaryId,
          kind: 'action_item',
          text: 'Send the deck',
          status: 'open',
        })
        .execute();
    });
    await expect(
      env.db.inWorkspace(a.workspaceId, (tx) =>
        tx
          .insertInto('summaryItems')
          .values({
            id: id('itm'),
            workspaceId: a.workspaceId,
            summaryId,
            kind: 'decision',
            text: 'Ship Friday',
            status: 'open',
          })
          .execute(),
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
