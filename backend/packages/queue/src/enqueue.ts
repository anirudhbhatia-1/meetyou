import type { WorkspaceTx } from '@meetyou/db';
import { sql } from 'kysely';
import type { z } from 'zod';

import type { TaskDefinition } from './tasks.ts';

export interface EnqueueOptions {
  /** De-duplicates: while a job with this key is pending, it is replaced instead of added. */
  jobKey?: string;
  /** Earliest run time, e.g. a deletion's `execute_after` (10 s undo grace). */
  runAt?: Date;
  priority?: number;
}

/**
 * Creates a job in the caller's transaction (ADR-0005 §3.1): the job exists if and only if the data
 * change commits, so the queue is the outbox. Payloads are validated before they are stored.
 * `job_key_mode` stays at graphile-worker's default `replace` (worker.graphile.org/docs/sql-add-job,
 * checked 2026-11-06): a pending job with the same key is updated; one that already ran may run
 * again, which idempotent handlers allow.
 */
export async function enqueue<S extends z.ZodType>(
  tx: WorkspaceTx,
  // The handler is not needed to create a job, so services that only enqueue pass the descriptor.
  task: Pick<TaskDefinition<S>, 'name' | 'schema' | 'maxAttempts'>,
  payload: z.infer<S>,
  options: EnqueueOptions = {},
): Promise<void> {
  const valid: unknown = task.schema.parse(payload);
  await sql`select graphile_worker.add_job(
    identifier => ${task.name},
    payload => ${JSON.stringify(valid)}::json,
    run_at => ${options.runAt ?? null}::timestamptz,
    max_attempts => ${task.maxAttempts}::smallint,
    job_key => ${options.jobKey ?? null}::text,
    priority => ${options.priority ?? 0}::smallint
  )`.execute(tx);
}
