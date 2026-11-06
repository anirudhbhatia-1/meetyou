import { randomBytes } from 'node:crypto';

import { run, runMigrations, type Job, type Runner, type Task } from 'graphile-worker';
import { traced } from '@meetyou/tracing';
import type pg from 'pg';

import type { TaskDefinition } from './tasks.ts';

/** Installs or upgrades graphile-worker's own schema; run with the database migrations. */
export async function installQueueSchema(pool: pg.Pool): Promise<void> {
  await runMigrations({ pgPool: pool });
}

export interface WorkerOptions {
  pool: pg.Pool;
  tasks: readonly TaskDefinition[];
  concurrency?: number;
  /** graphile-worker crontab lines for periodic jobs (usage rollups, sweeps). */
  crontab?: string;
  /** Tests and embedded use; Cloud Run workers keep graceful SIGTERM handling (ADR-0005 §3.2). */
  handleSignals?: boolean;
  pollIntervalMs?: number;
  /**
   * Tests on PGlite (one shared session behind pglite-socket): named prepared statements from two
   * connections collide there ("already exists"). Real Postgres keeps them.
   */
  noPreparedStatements?: boolean;
  /** Alert hook after a job used all its attempts (it is already recorded in `failed_jobs`). */
  onPermanentFailure?: (failure: { task: string; jobId: string; errorCode: string }) => void;
}

const WORKSPACE_ID = /^ws_[0-9A-HJKMNP-TV-Z]{26}$/;

function meetingOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as { meetingId?: unknown }).meetingId;
  return typeof value === 'string' ? value : null;
}

function workspaceOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as { workspaceId?: unknown }).workspaceId;
  return typeof value === 'string' && WORKSPACE_ID.test(value) ? value : null;
}

/** Error class name only: messages may carry content (AGENTS §7). */
function errorCode(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 100) : 'UnknownError';
}

/** The payload failed its schema: retrying cannot help, so the job is dead-lettered at once. */
export class InvalidPayload extends Error {
  constructor() {
    super('invalid job payload');
    this.name = 'InvalidPayload';
  }
}

/**
 * Runs the given tasks (ADR-0005 §3.2). Each payload is validated before its handler runs. Jobs
 * that fail every attempt are written to `failed_jobs` from the `job:failed` event, so application
 * code never reads graphile-worker's internal tables (ADR-0005 §3.1).
 */
export async function startWorker(options: WorkerOptions): Promise<Runner> {
  const { pool } = options;
  const taskList: Record<string, Task> = {};
  for (const task of options.tasks) {
    taskList[task.name] = async (payload, helpers) => {
      const parsed = task.schema.safeParse(payload);
      if (!parsed.success) {
        await recordFailure(pool, helpers.job, 'InvalidPayload');
        options.onPermanentFailure?.({
          task: task.name,
          jobId: helpers.job.id,
          errorCode: 'InvalidPayload',
        });
        return;
      }
      const meetingId = meetingOf(parsed.data);
      const work = () => task.handle(parsed.data, helpers);
      // Each pipeline job joins its meeting's trace (ARCHITECTURE §20).
      await (meetingId === null
        ? work()
        : traced(
            `job.${task.name}`,
            meetingId,
            { task: task.name, jobId: helpers.job.id, attempt: helpers.job.attempts },
            work,
          ));
    };
  }
  const runner = await run({
    pgPool: pool,
    taskList,
    concurrency: options.concurrency ?? 4,
    noHandleSignals: options.handleSignals === false,
    pollInterval: options.pollIntervalMs ?? 2_000,
    noPreparedStatements: options.noPreparedStatements === true,
    ...(options.crontab !== undefined ? { crontab: options.crontab } : {}),
  });
  runner.events.on('job:failed', ({ job, error }) => {
    const code = errorCode(error);
    recordFailure(pool, job, code)
      .then(() =>
        options.onPermanentFailure?.({ task: job.task_identifier, jobId: job.id, errorCode: code }),
      )
      .catch((failure: unknown) => {
        console.error('queue: recording a failed job failed', job.id, errorCode(failure));
      });
  });
  return runner;
}

async function recordFailure(pool: pg.Pool, job: Job, code: string): Promise<void> {
  await pool.query(
    `INSERT INTO failed_jobs (id, workspace_id, task, job_id, job_key, attempts, error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      `fj_${randomBytes(12).toString('hex')}`,
      workspaceOf(job.payload),
      job.task_identifier,
      job.id,
      job.key,
      job.attempts,
      code,
    ],
  );
}
