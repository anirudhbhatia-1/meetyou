import { newUlid } from '@meetyou/contracts';
import type { Runner } from 'graphile-worker';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { enqueue } from './enqueue.ts';
import { defineTask, jobKey } from './tasks.ts';
import { createQueueTestEnv } from './testing.ts';
import { startWorker } from './worker.ts';

let env: Awaited<ReturnType<typeof createQueueTestEnv>>;
let runner: Runner | null = null;

beforeEach(async () => {
  env = await createQueueTestEnv();
});

afterEach(async () => {
  await runner?.stop();
  runner = null;
  await env.close();
});

const id = (prefix: string) => `${prefix}_${newUlid()}`;

async function account() {
  const result = await env.db.signInGoogleUser(
    { googleSub: id('g'), email: 'a@example.com', displayName: 'A' },
    { userId: id('usr'), workspaceId: id('ws'), membershipId: id('mem'), settingsId: id('set') },
  );
  if (result.workspaceId === null) throw new Error('no workspace');
  return { ...result, workspaceId: result.workspaceId };
}

async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}

const Payload = z.object({ workspaceId: z.string(), meetingId: z.string() });

describe('queue (ADR-0005)', () => {
  it('creates a job only when its transaction commits (check 1)', async () => {
    const seen: string[] = [];
    const task = defineTask('meeting.finalize', Payload, async (p) => {
      seen.push(p.meetingId);
    });
    const a = await account();
    await env.db.inWorkspace(a.workspaceId, (tx) =>
      enqueue(tx, task, { workspaceId: a.workspaceId, meetingId: 'mtg_committed' }),
    );
    await expect(
      env.db.inWorkspace(a.workspaceId, async (tx) => {
        await enqueue(tx, task, { workspaceId: a.workspaceId, meetingId: 'mtg_rolled_back' });
        throw new Error('domain write failed');
      }),
    ).rejects.toThrow('domain write failed');

    runner = await startWorker({
      pool: env.pool,
      tasks: [task],
      handleSignals: false,
      pollIntervalMs: 100,
      noPreparedStatements: true,
    });
    await until(() => seen.length > 0);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual(['mtg_committed']);
  });

  it('runs a job key once while it is pending', async () => {
    const seen: string[] = [];
    const task = defineTask('meeting.summarize', Payload, async (p) => {
      seen.push(p.meetingId);
    });
    const a = await account();
    const key = jobKey(task.name, 'mtg_1', 1);
    for (let i = 0; i < 3; i++) {
      await env.db.inWorkspace(a.workspaceId, (tx) =>
        enqueue(tx, task, { workspaceId: a.workspaceId, meetingId: 'mtg_1' }, { jobKey: key }),
      );
    }
    runner = await startWorker({
      pool: env.pool,
      tasks: [task],
      handleSignals: false,
      pollIntervalMs: 100,
      noPreparedStatements: true,
    });
    await until(() => seen.length > 0);
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual(['mtg_1']);
  });

  it('waits for run_at (e.g. the 10 s delete grace)', async () => {
    const seen: string[] = [];
    const task = defineTask('meeting.delete', Payload, async (p) => {
      seen.push(p.meetingId);
    });
    const a = await account();
    await env.db.inWorkspace(a.workspaceId, (tx) =>
      enqueue(
        tx,
        task,
        { workspaceId: a.workspaceId, meetingId: 'mtg_later' },
        { runAt: new Date(Date.now() + 60_000) },
      ),
    );
    runner = await startWorker({
      pool: env.pool,
      tasks: [task],
      handleSignals: false,
      pollIntervalMs: 100,
      noPreparedStatements: true,
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toEqual([]);
  });

  it('dead-letters a job that fails every attempt, without content', async () => {
    class ProviderDown extends Error {
      override name = 'ProviderDown';
    }
    const task = defineTask(
      'meeting.transcribe',
      Payload,
      () => Promise.reject(new ProviderDown('vendor said: Asha Rao is unavailable')),
      { maxAttempts: 1 },
    );
    const failures: string[] = [];
    const a = await account();
    await env.db.inWorkspace(a.workspaceId, (tx) =>
      enqueue(tx, task, { workspaceId: a.workspaceId, meetingId: 'mtg_x' }),
    );
    runner = await startWorker({
      pool: env.pool,
      tasks: [task],
      handleSignals: false,
      pollIntervalMs: 100,
      noPreparedStatements: true,
      onPermanentFailure: (f) => failures.push(`${f.task}:${f.errorCode}`),
    });
    await until(() => failures.length > 0);
    expect(failures).toEqual(['meeting.transcribe:ProviderDown']);
    // The application may write the dead letter but not read it (RLS insert-only policy).
    expect((await env.pool.query('SELECT * FROM failed_jobs')).rows).toEqual([]);
  });

  it('refuses invalid payloads before they are stored', async () => {
    const task = defineTask('meeting.index', Payload, () => Promise.resolve());
    const a = await account();
    await expect(
      env.db.inWorkspace(a.workspaceId, (tx) =>
        enqueue(tx, task, { workspaceId: a.workspaceId } as unknown as z.infer<typeof Payload>),
      ),
    ).rejects.toThrow();
    expect(() => defineTask('Bad Name', Payload, () => Promise.resolve())).toThrow();
  });
});
