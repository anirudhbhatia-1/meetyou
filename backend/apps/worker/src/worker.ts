import { createServer, type Server } from 'node:http';

import { Db } from '@meetyou/db';
import { createLogger, errorCode } from '@meetyou/log';
import {
  accountDeleteTask,
  installQueueSchema,
  meetingDeleteTask,
  retentionSweepTask,
  startWorker,
  type StorageCleanup,
  type TaskDefinition,
} from '@meetyou/queue';
import { meetingPrefix, ObjectVideoStore, type ObjectBucket } from '@meetyou/storage';
import { videoFinalizeTask, type FfmpegTools } from '@meetyou/video';
import type { Runner } from 'graphile-worker';
import type pg from 'pg';

const logger = createLogger('worker');

/**
 * Recording objects for the lifecycle jobs (S2-10): a meeting's whole prefix on delete, one
 * object (plus the poster next to a playback file) on retention. Deleting is idempotent.
 */
export function bucketCleanup(bucket: ObjectBucket): StorageCleanup {
  const deletePrefix = async (prefix: string): Promise<void> => {
    for (const { key } of await bucket.list(prefix)) await bucket.delete(key);
  };
  return {
    deleteMeetingFiles: (workspaceId, meetingId) =>
      deletePrefix(meetingPrefix(workspaceId, meetingId)),
    // An audio asset may name a lane prefix (chunks) or one object.
    deleteAudioFile: (key) => (key.endsWith('/') ? deletePrefix(key) : bucket.delete(key)),
    async deleteVideoFile(key) {
      await bucket.delete(key);
      if (key.endsWith('/playback.mp4')) {
        await bucket.delete(key.replace(/playback\.mp4$/, 'poster.jpg'));
      }
    },
  };
}

/** Every task the worker runs. TODO(S3-03): the processing pipeline joins here. */
export function workerTasks(deps: {
  db: Db;
  bucket: ObjectBucket;
  tools?: FfmpegTools;
}): TaskDefinition[] {
  const storage = bucketCleanup(deps.bucket);
  return [
    videoFinalizeTask({
      db: deps.db,
      store: new ObjectVideoStore(deps.bucket),
      ...(deps.tools !== undefined ? { tools: deps.tools } : {}),
    }),
    meetingDeleteTask({ db: deps.db, storage }),
    accountDeleteTask({ db: deps.db, storage }),
    retentionSweepTask({ db: deps.db, storage }),
  ];
}

/** Due jobs no worker has picked up, and how long the oldest has waited (S2-11 queue backlog). */
export async function queueDepth(pool: pg.Pool): Promise<{ count: number; oldestMs: number }> {
  const { rows } = await pool.query<{ count: number; oldest_ms: number | null }>(
    `select count(*)::int as count,
            (extract(epoch from now() - min(run_at)) * 1000)::bigint as oldest_ms
       from graphile_worker.jobs
      where run_at <= now() and locked_at is null and attempts < max_attempts`,
  );
  return { count: rows[0]?.count ?? 0, oldestMs: Number(rows[0]?.oldest_ms ?? 0) };
}

/** Sampled for the queue_depth log metric; one line a minute. */
const QUEUE_SAMPLE_MS = 60_000;

export interface RunningWorker {
  runner: Runner;
  health: Server;
  stop(): Promise<void>;
}

/**
 * Starts the worker: refuses a database role that bypasses row-level security, installs the
 * queue schema (idempotent), runs the tasks, and serves `/healthz` (Cloud Run starts a service
 * only once it listens on PORT; the endpoint reports 503 if the runner stopped).
 */
export async function runWorker(options: {
  pool: pg.Pool;
  bucket: ObjectBucket;
  port: number;
  host?: string;
  concurrency?: number;
  tools?: FfmpegTools;
  handleSignals?: boolean;
  pollIntervalMs?: number;
  /** Tests on PGlite only (see `@meetyou/queue` WorkerOptions). */
  noPreparedStatements?: boolean;
  queueSampleMs?: number;
}): Promise<RunningWorker> {
  const db = new Db(options.pool);
  await db.assertRowSecurityEnforced();
  await installQueueSchema(options.pool);
  const runner = await startWorker({
    pool: options.pool,
    tasks: workerTasks({
      db,
      bucket: options.bucket,
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
    }),
    concurrency: options.concurrency ?? 2,
    handleSignals: options.handleSignals ?? true,
    ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
    noPreparedStatements: options.noPreparedStatements === true,
    onPermanentFailure: ({ task, jobId, errorCode }) => {
      // IDs and codes only (AGENTS §7); the job_dead_lettered alert matches this line (S2-11).
      logger.error('job.dead_lettered', { task, jobId, errorCode });
    },
  });
  let stopped = false;
  void runner.promise.finally(() => {
    stopped = true;
  });
  const health = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(stopped ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: !stopped }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) =>
    health.listen(options.port, options.host ?? '0.0.0.0', resolve),
  );
  const sampler = setInterval(() => {
    queueDepth(options.pool).then(
      (depth) => logger.log('queue.depth', depth),
      (error: unknown) => logger.log('queue.depth_failed', { code: errorCode(error) }),
    );
  }, options.queueSampleMs ?? QUEUE_SAMPLE_MS);
  sampler.unref();
  return {
    runner,
    health,
    async stop() {
      clearInterval(sampler);
      await runner.stop();
      await new Promise<void>((resolve) => health.close(() => resolve()));
      await db.destroy();
    },
  };
}
