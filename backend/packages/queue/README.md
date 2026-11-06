# @meetyou/queue (S2-06)

Background jobs on graphile-worker ([ADR-0005](../../../docs/adr/0005-job-queue-and-outbox.md)).

- `enqueue(tx, task, payload, { jobKey, runAt })` creates the job **in the caller's transaction**
  (`Db.inWorkspace`): it exists if and only if the data change commits, so the queue is the outbox.
  Payloads are validated against the task's zod schema before they are stored; they carry IDs only.
- `defineTask(name, schema, handler, { maxAttempts })`: 8 attempts by default (graphile-worker's
  exponential backoff), then dead letter. `jobKey(task, meetingId, inputVersion)` de-duplicates a
  pending job.
- `startWorker({ pool, tasks, crontab })` runs tasks, validates payloads first, and writes jobs that
  failed every attempt (or had an invalid payload) to `failed_jobs` from the `job:failed` event, so
  application code never reads graphile-worker's tables. `failed_jobs` is insert-only for the app
  (RLS); operators read it. Only the error's class name is stored.
- `installQueueSchema(pool)` installs graphile-worker's schema; run it with the database migrations.

Tests run on PGlite served over TCP by `@electric-sql/pglite-socket` (decided 2026-11-06), as the
non-superuser `meetyou_app`, like Cloud SQL.

Not yet: Cloud Run worker service and its SIGTERM handling (ADR-0005 §3.2, S2-12), connection
budget against Cloud SQL limits (ADR-0005 check 2), the alert behind `onPermanentFailure` (S2-11).
