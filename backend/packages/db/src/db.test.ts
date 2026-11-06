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
  const result = await db.signInGoogleUser(
    { googleSub: sub, email: `${sub}@example.com`, displayName: `User ${sub}` },
    accountIds(),
  );
  const { workspaceId } = result;
  if (workspaceId === null) throw new Error('sign-in returned no workspace');
  return { ...result, workspaceId };
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
    expect(rows.map((r) => r.version)).toEqual(['0001', '0002', '0003']);
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
          meetingId,
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
            meetingId,
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

describe('refresh tokens (ADR-0004 §4.3)', () => {
  const hash = (n: number) => n.toString(16).padStart(64, '0');
  const later = () => new Date(Date.now() + 30 * 24 * 3600 * 1000);

  async function issued() {
    const user = await signIn(env.db, 'r');
    await env.db.issueRefreshToken({
      userId: user.userId,
      workspaceId: user.workspaceId,
      familyId: id('rtf'),
      tokenId: id('rt'),
      tokenHash: hash(1),
      expiresAt: later(),
    });
    return user;
  }

  const rotate = (from: number, to: number, expiresAt = later()) =>
    env.db.rotateRefreshToken({
      tokenHash: hash(from),
      newTokenId: id('rt'),
      newTokenHash: hash(to),
      newExpiresAt: expiresAt,
    });

  it('rotates: the old token is spent and the new one works', async () => {
    const user = await issued();
    expect(await rotate(1, 2)).toEqual({
      status: 'ok',
      userId: user.userId,
      workspaceId: user.workspaceId,
    });
    expect((await rotate(2, 3)).status).toBe('ok');
  });

  /** Moves every used token's `used_at` back past the reuse grace window (superuser, test only). */
  async function ageUsedTokens() {
    await env.pg.exec(`RESET ROLE;
      UPDATE refresh_tokens SET used_at = used_at - interval '1 minute' WHERE used_at IS NOT NULL;
      SET ROLE meetyou_app;`);
  }

  it('lets a retried refresh within 30 s through instead of logging the user out', async () => {
    await issued();
    await rotate(1, 2);
    // The response was lost and the client retries with the same token.
    expect((await rotate(1, 3)).status).toBe('ok');
    expect((await rotate(3, 4)).status).toBe('ok');
  });

  it('revokes the whole family when a used token comes back (theft signal)', async () => {
    await issued();
    await rotate(1, 2);
    await ageUsedTokens();
    expect((await rotate(1, 9)).status).toBe('reused');
    // The legitimate holder's newer token is dead too: both parties must sign in again.
    expect((await rotate(2, 3)).status).toBe('revoked');
  });

  it('refuses unknown and expired tokens', async () => {
    await issued();
    expect((await rotate(7, 8)).status).toBe('unknown');
    expect((await rotate(1, 2, new Date(Date.now() - 1000))).status).toBe('ok');
    expect((await rotate(2, 3)).status).toBe('expired');
  });

  it('stops refreshing for a workspace the user no longer belongs to', async () => {
    const user = await issued();
    await env.pg.exec(`RESET ROLE; DELETE FROM memberships WHERE user_id = '${user.userId}';
      SET ROLE meetyou_app;`);
    expect((await rotate(1, 2)).status).toBe('revoked');
    await expect(
      env.db.issueRefreshToken({
        userId: user.userId,
        workspaceId: user.workspaceId,
        familyId: id('rtf'),
        tokenId: id('rt'),
        tokenHash: hash(5),
        expiresAt: later(),
      }),
    ).rejects.toThrow(/not a member/);
  });

  it('logout revokes the family', async () => {
    await issued();
    expect(await env.db.revokeRefreshFamily(hash(1), 'logout')).toBe(true);
    expect((await rotate(1, 2)).status).toBe('revoked');
    expect(await env.db.revokeRefreshFamily(hash(5), 'logout')).toBe(false);
  });

  it('keeps token rows invisible without the token or its user', async () => {
    await issued();
    expect((await env.pg.query('SELECT id FROM refresh_tokens')).rows).toEqual([]);
    expect((await env.pg.query('SELECT id FROM refresh_token_families')).rows).toEqual([]);
  });
});

describe('review fixes (2026-11-05)', () => {
  it('refuses migrations sharing a version and edits to applied ones', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    try {
      await writeFile(join(dir, '0001_a.sql'), 'CREATE TABLE a1 (id int);');
      await writeFile(join(dir, '0001_b.sql'), 'CREATE TABLE b1 (id int);');
      await expect(migrate(pgliteRunner(env.pg), dir)).rejects.toThrow(/share version 0001/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const edited = await mkdtemp(join(tmpdir(), 'mig-'));
    try {
      const { readFile } = await import('node:fs/promises');
      const { MIGRATIONS_DIR } = await import('./migrate.ts');
      for (const name of ['0001_init.sql', '0002_refresh_tokens.sql']) {
        await writeFile(join(edited, name), await readFile(join(MIGRATIONS_DIR, name), 'utf8'));
      }
      await writeFile(join(edited, '0002_refresh_tokens.sql'), '-- changed');
      await expect(migrate(pgliteRunner(env.pg), edited)).rejects.toThrow(
        /changed after it was applied/,
      );
    } finally {
      await rm(edited, { recursive: true, force: true });
    }
  });

  it('refuses to run as a role that bypasses row security', async () => {
    await env.db.assertRowSecurityEnforced();
    await env.pg.exec('RESET ROLE');
    await expect(env.db.assertRowSecurityEnforced()).rejects.toThrow(/bypasses row-level security/);
    await env.pg.exec('SET ROLE meetyou_app');
  });

  it('returns int8 as number and date as YYYY-MM-DD, like production', async () => {
    const a = await signIn(env.db, 'a');
    const meetingId = await addMeeting(env.db, a.workspaceId);
    const summaryId = id('sum');
    const row = await env.db.inWorkspace(a.workspaceId, async (tx) => {
      await tx
        .insertInto('audioAssets')
        .values({
          id: id('aud'),
          workspaceId: a.workspaceId,
          meetingId,
          lane: 'me',
          storageKey: 'k1',
          codec: 'opus',
          bytes: 1234,
          durationMs: 10_000,
        })
        .execute();
      await tx
        .insertInto('summaries')
        .values({
          id: summaryId,
          workspaceId: a.workspaceId,
          meetingId,
          version: 1,
          template: 'general',
          language: 'en',
          model: 't',
          status: 'ready',
        })
        .execute();
      await tx
        .insertInto('summaryItems')
        .values({
          id: id('itm'),
          workspaceId: a.workspaceId,
          meetingId,
          summaryId,
          kind: 'action_item',
          text: 'x',
          status: 'open',
          dueDate: '2026-11-06',
        })
        .execute();
      return {
        audio: await tx.selectFrom('audioAssets').select('bytes').executeTakeFirstOrThrow(),
        item: await tx.selectFrom('summaryItems').select('dueDate').executeTakeFirstOrThrow(),
      };
    });
    expect(row.audio.bytes).toBe(1234);
    expect(row.item.dueDate).toBe('2026-11-06');
  });

  it('keeps citations inside one meeting', async () => {
    const a = await signIn(env.db, 'a');
    const m1 = await addMeeting(env.db, a.workspaceId);
    const m2 = await addMeeting(env.db, a.workspaceId);
    const segment = `seg_${newUlid()}`;
    const itemId = id('itm');
    await expect(
      env.db.inWorkspace(a.workspaceId, async (tx) => {
        await tx
          .insertInto('transcriptSegments')
          .values({
            id: segment,
            workspaceId: a.workspaceId,
            meetingId: m2,
            lane: 'me',
            startMs: 0,
            endMs: 100,
            text: 'hi',
            rawText: 'hi',
            language: 'en',
            source: 'live',
          })
          .execute();
        const summaryId = id('sum');
        await tx
          .insertInto('summaries')
          .values({
            id: summaryId,
            workspaceId: a.workspaceId,
            meetingId: m1,
            version: 1,
            template: 'general',
            language: 'en',
            model: 't',
            status: 'ready',
          })
          .execute();
        await tx
          .insertInto('summaryItems')
          .values({
            id: itemId,
            workspaceId: a.workspaceId,
            meetingId: m1,
            summaryId,
            kind: 'decision',
            text: 'x',
          })
          .execute();
        await tx
          .insertInto('citations')
          .values({
            id: id('cit'),
            workspaceId: a.workspaceId,
            meetingId: m1,
            summaryItemId: itemId,
            segmentId: segment,
          })
          .execute();
      }),
    ).rejects.toThrow(/foreign key/);
  });

  it('keeps the deletion audit trail when the workspace is deleted', async () => {
    const a = await signIn(env.db, 'a');
    await env.db.inWorkspace(a.workspaceId, (tx) =>
      tx
        .insertInto('deletionRequests')
        .values({
          id: id('del'),
          workspaceId: a.workspaceId,
          scope: 'account',
          targetId: a.userId,
          executeAfter: new Date(),
        })
        .execute(),
    );
    await env.pg.exec(`RESET ROLE; DELETE FROM workspaces WHERE id = '${a.workspaceId}';`);
    const { rows } = await env.pg.query<{ workspace_id: string | null }>(
      'SELECT workspace_id FROM deletion_requests',
    );
    await env.pg.exec('SET ROLE meetyou_app');
    expect(rows).toEqual([{ workspace_id: null }]);
  });

  it('serialises concurrent first sign-ins of one Google account', async () => {
    const [x, y] = await Promise.all([signIn(env.db, 'same'), signIn(env.db, 'same')]);
    expect(x.userId).toBe(y.userId);
  });
});
