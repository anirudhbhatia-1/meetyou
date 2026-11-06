import { z } from 'zod';

/** Worker settings (STAGING_SETUP §9). Everything it needs is required: a half-configured worker
 * would take jobs and fail them. */
export const WorkerEnv = z.object({
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']).default('local'),
  /** Cloud Run sets it; the health endpoint listens here. */
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  GCS_AUDIO_BUCKET: z.string().min(3),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
});
export type WorkerEnv = z.infer<typeof WorkerEnv>;

export function loadWorkerEnv(env: NodeJS.ProcessEnv): WorkerEnv {
  const parsed = WorkerEnv.safeParse(env);
  if (!parsed.success) {
    // Names only; values can be secrets.
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`worker: invalid or missing ${missing}`);
  }
  return parsed.data;
}
