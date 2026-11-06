import type { JobHelpers } from 'graphile-worker';
import type { z } from 'zod';

/**
 * A background task: its name, the zod schema of its payload, and an idempotent handler that reads
 * persisted inputs only (ADR-0005 §3.1, ARCHITECTURE §9.3). Payloads carry IDs, never content.
 */
export interface TaskDefinition<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly schema: S;
  readonly maxAttempts: number;
  handle(payload: z.infer<S>, helpers: JobHelpers): Promise<void>;
}

/** ADR-0005 §3.1: eight attempts with exponential backoff, then dead letter. */
export const DEFAULT_MAX_ATTEMPTS = 8;

const NAME = /^[a-z][a-z0-9_.]{0,99}$/;

export function defineTask<S extends z.ZodType>(
  name: string,
  schema: S,
  handle: (payload: z.infer<S>, helpers: JobHelpers) => Promise<void>,
  options: { maxAttempts?: number } = {},
): TaskDefinition<S> {
  if (!NAME.test(name)) throw new Error(`invalid task name ${name}`);
  return { name, schema, maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, handle };
}

/** ADR-0005 §3.1 job keys: `<task>:<meeting_id>:<input_version>`, so a retried request is one job. */
export function jobKey(task: string, meetingId: string, inputVersion: number | string): string {
  return `${task}:${meetingId}:${inputVersion}`;
}
