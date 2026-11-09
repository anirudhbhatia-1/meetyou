import { inflateRawSync } from 'node:zlib';

import { newUlid, type Segment } from '@meetyou/contracts';
import { createMeetingForSession, endMeeting, storeSegments } from '@meetyou/db';
import { createQueueTestEnv } from '@meetyou/queue/testing';
import { MemoryBucket } from '@meetyou/storage';
import type { JobHelpers } from 'graphile-worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureSelfParticipant } from '../meeting-data.ts';
import { storeSummary } from '../store.ts';
import { exportExpireTask, exportTask } from './task.ts';
import { zip } from './zip.ts';

/** Reads a zip back through its central directory (test-only counterpart of zip.ts). */
function unzip(data: Uint8Array): Map<string, string> {
  const buf = Buffer.from(data);
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const offset = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    const localName = buf.readUInt16LE(offset + 26);
    const body = buf.subarray(offset + 30 + localName, offset + 30 + localName + size);
    files.set(name, (method === 8 ? inflateRawSync(body) : body).toString('utf8'));
    at += 46 + nameLength;
  }
  return files;
}

describe('zip', () => {
  it('round-trips stored and deflated entries with UTF-8 names', () => {
    const files = unzip(
      zip([
        { name: 'a.txt', data: new TextEncoder().encode('x') },
        { name: 'नोट्स/b.md', data: new TextEncoder().encode('hello '.repeat(200)) },
      ]),
    );
    expect(files.get('a.txt')).toBe('x');
    expect(files.get('नोट्स/b.md')).toBe('hello '.repeat(200));
  });
});

/** S3-11 end to end on PGlite with RLS: archive contents, ready row, expiry job, file deletion. */
describe('account.export', () => {
  let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
  const people: { workspaceId: string; userId: string }[] = [];
  const bucket = new MemoryBucket();
  const helpers = { job: { attempts: 1, max_attempts: 3 } } as JobHelpers;
  let meetingId = '';

  beforeAll(async () => {
    env = await createQueueTestEnv();
    for (const sub of ['exp-a', 'exp-b']) {
      const account = await env.db.signInGoogleUser(
        { googleSub: sub, email: `${sub}@example.com`, displayName: sub },
        {
          userId: `usr_${newUlid()}`,
          workspaceId: `ws_${newUlid()}`,
          membershipId: `mem_${newUlid()}`,
          settingsId: `set_${newUlid()}`,
        },
      );
      people.push({ workspaceId: account.workspaceId ?? '', userId: account.userId });
    }
    const workspaceId = people[0]?.workspaceId ?? '';
    meetingId = `mtg_${newUlid()}`;
    const segs: Segment[] = [
      'Decision: release Friday tak move karte hain.',
      'Main refund bug kal tak fix kar dunga.',
    ].map((text, i) => ({
      id: `seg_${newUlid()}`,
      workspaceId,
      meetingId,
      lane: i === 0 ? 'them' : 'me',
      startMs: 60_000 + i * 5_000,
      endMs: 63_000 + i * 5_000,
      text,
      rawText: text,
      language: 'hi',
      source: 'live',
      flags: [],
    }));
    await env.db.inWorkspace(workspaceId, async (tx) => {
      await createMeetingForSession(tx, {
        id: meetingId,
        workspaceId,
        sessionId: `ses_${newUlid()}`,
        externalMeetingCode: 'abc-defg-hij',
        title: 'Weekly sync',
        startedAt: new Date('2026-11-07T04:30:00Z'),
      });
      await storeSegments(tx, segs, () => `spc_${newUlid()}`);
      await endMeeting(tx, meetingId, new Date('2026-11-07T04:40:00Z'));
      await ensureSelfParticipant(tx, workspaceId, meetingId);
      await tx
        .insertInto('glossaryTerms')
        .values({
          id: `gls_${newUlid()}`,
          workspaceId,
          term: 'Razorpay',
          createdBy: people[0]?.userId ?? '',
        })
        .execute();
      await storeSummary(tx, {
        workspaceId,
        meetingId,
        template: 'general',
        language: 'hinglish',
        model: 'fake-model',
        accepted: true,
        usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0 },
        summary: {
          title: 'Weekly sync',
          overview: 'Release moves to Friday.',
          report: {
            citationsDropped: 0,
            unverified: 0,
            ownersUnassigned: 0,
            datesResolved: 0,
            unknownNotes: 0,
          },
          items: [
            {
              kind: 'decision',
              text: 'Release on Friday',
              anchorNoteId: null,
              ownerParticipantId: null,
              dueDate: null,
              duePhrase: null,
              segmentIds: [segs[0]?.id ?? ''],
              flagged: false,
              order: 0,
            },
            {
              kind: 'action_item',
              text: 'Fix the refund bug',
              anchorNoteId: null,
              ownerParticipantId: null,
              dueDate: '2026-11-08',
              duePhrase: 'kal tak',
              segmentIds: [segs[1]?.id ?? ''],
              flagged: false,
              order: 1,
            },
          ],
        },
      });
    });
  }, 60_000);

  afterAll(async () => {
    await env.close();
  });

  async function requestExport(who: number): Promise<string> {
    const { workspaceId, userId } = people[who] ?? { workspaceId: '', userId: '' };
    const exportId = `exp_${newUlid()}`;
    await env.db.inWorkspace(workspaceId, (tx) =>
      tx.insertInto('exports').values({ id: exportId, workspaceId, userId }).execute(),
    );
    return exportId;
  }

  const exportRow = (who: number, exportId: string) =>
    env.db.inWorkspace(people[who]?.workspaceId ?? '', (tx) =>
      tx.selectFrom('exports').selectAll().where('id', '=', exportId).executeTakeFirstOrThrow(),
    );

  it('writes the archive, marks it ready for 24 hours and schedules its deletion', async () => {
    const exportId = await requestExport(0);
    const now = Date.parse('2026-11-09T06:00:00Z');
    const task = exportTask({ db: env.db, bucket, now: () => now });
    const payload = {
      workspaceId: people[0]?.workspaceId ?? '',
      userId: people[0]?.userId ?? '',
      exportId,
    };
    await task.handle(payload, helpers);

    const row = await exportRow(0, exportId);
    expect(row).toMatchObject({ status: 'ready', meetingCount: 1 });
    expect(row.expiresAt?.toISOString()).toBe('2026-11-10T06:00:00.000Z');
    const object = bucket.objects.get(row.storageKey ?? '');
    expect(object?.contentType).toBe('application/zip');
    const files = unzip(object?.data ?? new Uint8Array());

    const folder = `meetings/weekly-sync-2026-11-07-${meetingId}`;
    expect([...files.keys()].sort()).toEqual(
      [
        'README.txt',
        'account.json',
        `${folder}/meeting.json`,
        `${folder}/notes.md`,
        `${folder}/transcript.md`,
      ].sort(),
    );
    const account = JSON.parse(files.get('account.json') ?? '{}') as Record<string, unknown>;
    expect(account).toMatchObject({ meetingCount: 1, vocabulary: ['Razorpay'] });
    expect(account.settings).not.toHaveProperty('workspaceId');
    const record = JSON.parse(files.get(`${folder}/meeting.json`) ?? '{}') as {
      transcript: { speaker: string; rawText: string }[];
      summary: { items: { citedSegmentIds: string[] }[] };
    };
    expect(record.transcript.map((s) => s.speaker)).toEqual(['Someone', 'You']);
    expect(record.summary.items[0]?.citedSegmentIds).toHaveLength(1);
    expect(files.get(`${folder}/notes.md`)).toContain('## Decisions\n- Release on Friday [1:00]');
    expect(files.get(`${folder}/notes.md`)).toContain(
      '- [ ] Fix the refund bug — Unassigned, 2026-11-08 [1:05]',
    );
    expect(files.get(`${folder}/transcript.md`)).toContain(
      '**[1:05] You:** Main refund bug kal tak fix kar dunga.',
    );

    const jobs = await env.pool.query<{ key: string; run_at: Date }>(
      `select key, run_at from graphile_worker.jobs where task_identifier = 'export.expire'`,
    );
    expect(jobs.rows).toEqual([
      { key: `export.expire:${exportId}`, run_at: new Date('2026-11-10T06:00:00Z') },
    ]);

    // A repeated run of a finished export does nothing.
    await task.handle(payload, helpers);
    expect(bucket.objects.size).toBe(1);

    await exportExpireTask({ db: env.db, bucket }).handle(payload, helpers);
    expect((await exportRow(0, exportId)).status).toBe('expired');
    expect(bucket.objects.has(row.storageKey ?? '')).toBe(false);
  });

  it("contains only the caller's own meetings", async () => {
    const exportId = await requestExport(1);
    const payload = {
      workspaceId: people[1]?.workspaceId ?? '',
      userId: people[1]?.userId ?? '',
      exportId,
    };
    await exportTask({ db: env.db, bucket }).handle(payload, helpers);
    const row = await exportRow(1, exportId);
    expect(row.meetingCount).toBe(0);
    const files = unzip(bucket.objects.get(row.storageKey ?? '')?.data ?? new Uint8Array());
    expect([...files.keys()].sort()).toEqual(['README.txt', 'account.json']);
  });

  it('marks the export failed after the last attempt', async () => {
    const exportId = await requestExport(0);
    const broken = {
      ...bucket,
      save: () => Promise.reject(new Error('bucket down')),
    } as unknown as MemoryBucket;
    const payload = {
      workspaceId: people[0]?.workspaceId ?? '',
      userId: people[0]?.userId ?? '',
      exportId,
    };
    const task = exportTask({ db: env.db, bucket: broken });
    await expect(task.handle(payload, helpers)).rejects.toThrow('bucket down');
    expect((await exportRow(0, exportId)).status).toBe('preparing');
    await expect(
      task.handle(payload, { job: { attempts: 3, max_attempts: 3 } } as JobHelpers),
    ).rejects.toThrow('bucket down');
    expect((await exportRow(0, exportId)).status).toBe('failed');
  });
});
