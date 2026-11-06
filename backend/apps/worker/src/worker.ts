import { createServer, type Server } from 'node:http';

import { Db } from '@meetyou/db';
import { installQueueSchema, startWorker, type TaskDefinition } from '@meetyou/queue';
import { ObjectVideoStore, type ObjectBucket } from '@meetyou/storage';
import { videoFinalizeTask, type FfmpegTools } from '@meetyou/video';
import type { Runner } from 'graphile-worker';
import type pg from 'pg';

/** Every task the worker runs. TODO(S3-03, S2-10): summaries and retention join here. */
export function workerTasks(deps: {
  db: Db;
  bucket: ObjectBucket;
  tools?: FfmpegTools;
}): TaskDefinition[] {
  return [
    videoFinalizeTask({
      db: deps.db,
      store: new ObjectVideoStore(deps.bucket),
      ...(deps.tools !== undefined ? { tools: deps.tools } : {}),
    }),
  ];
}

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
    onPermanentFailure: ({ task, jobId, errorCode }) => {
      // IDs and codes only (AGENTS §7); alerting reads this log line (S2-11).
      console.error(JSON.stringify({ event: 'job.dead_lettered', task, jobId, errorCode }));
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
  return {
    runner,
    health,
    async stop() {
      await runner.stop();
      await new Promise<void>((resolve) => health.close(() => resolve()));
      await db.destroy();
    },
  };
}
