# ADR-0005: Job queue and outbox

| Field | Value |
|---|---|
| Status | **Accepted** (Anirudh, 2026-10-29) — verification items below run in Stage 1; a failed check reopens this ADR |
| Date | 2026-10-28 |
| Related | [ARCHITECTURE §9](../ARCHITECTURE.md) · [ADR-0002](0002-backend-stack-and-hosting.md) |

## 1. Context

The post-meeting pipeline (ARCHITECTURE §9.2) runs as background jobs: finalize, summarize,
validate, index, notify, batch re-transcription, speaker resolution, retention, deletion, export.
Requirements:

- **No lost events:** a job must exist if and only if the data change that caused it committed
  (outbox guarantee).
- Retries with backoff, a dead-letter state, scheduling (retention, deletion grace of 10 s,
  cron-like jobs), and idempotent handlers keyed by `(meeting_id, step, input_version)`.
- Runs on Cloud SQL Postgres and Cloud Run workers (ADR-0002); few moving parts.

## 2. Options

| Option | How the outbox guarantee is met | Notes | Verdict |
|---|---|---|---|
| **A. graphile-worker** | Call `graphile_worker.add_job(...)` in SQL **inside the same transaction** as the data change — the job is committed atomically with it, so the queue *is* the outbox | LISTEN/NOTIFY for low latency; cron; retries with backoff; job keys for de-duplication; `add_job` needs owner privileges → wrap in a `SECURITY DEFINER` function | **Recommended** |
| B. pg-boss | Separate `outbox` table written in the transaction, plus a dispatcher that moves rows into pg-boss | Mature; built-in dead-letter queues; transactional `send` not clearly documented | Alternative |
| C. Cloud Tasks / Pub/Sub | Separate outbox table + dispatcher (cannot join a Postgres transaction) | Managed, but adds a second system and the dispatcher anyway | Rejected for Phase 1 |
| D. Redis-based queue (BullMQ) | Separate outbox + dispatcher | Redis is ephemeral in our design (ARCHITECTURE §11.1) | Rejected |

## 3. Decision (proposed): Option A — graphile-worker

### 3.1 Usage rules
- Domain writes and job creation happen in **one transaction** through a single helper
  (`enqueue(tx, task, payload, { jobKey, runAt })`) that calls our `SECURITY DEFINER` wrapper
  around `graphile_worker.add_job`.
- **Job keys** = `<task>:<meeting_id>:<input_version>` so a retried request never creates duplicates.
- Handlers are idempotent and read persisted inputs only (ARCHITECTURE §9.3).
- **Dead letter:** after `max_attempts` (default 8, exponential backoff) the job is marked failed;
  a scheduled job copies permanently failed jobs into a `failed_jobs` table and alerts.
- **Scheduling:** retention and deletion use `run_at` (e.g. `execute_after` for the 10-second delete
  grace); periodic jobs (usage rollups, failed-job sweep) use the cron feature.
- Application code never reads or edits graphile-worker's internal tables directly (the docs warn
  this can cause out-of-order execution).

### 3.2 Workers on Cloud Run
- Worker service with CPU always allocated and `min-instances ≥ 1` in production so LISTEN/NOTIFY
  is responsive; concurrency set per task type; scale on queue depth metric.
- Graceful shutdown on SIGTERM: stop taking jobs, finish or release running ones.

## 4. Consequences
- The ARCHITECTURE §9.1 "outbox table + dispatcher" is replaced by transactional job creation; an
  explicit outbox table is only needed if we later publish events to external systems.
- Database role setup: application role + owner role for the wrapper function (migration).
- If graphile-worker does not fit (e.g. connection limits on Cloud SQL), switch to Option B; the
  `enqueue` helper hides the choice from domain code.

## 5. Verification before acceptance
| # | Check | Owner |
|---|---|---|
| 1 | `add_job` via `SECURITY DEFINER` wrapper inside a transaction: job visible only after commit, absent after rollback (test) | Anirudh |
| 2 | Connection usage per worker vs Cloud SQL connection limits for the chosen tier | Anirudh |
| 3 | Current graphile-worker version supports Postgres version chosen in ADR-0002 check 2 | Anirudh |

## 6. Sources
- [graphile-worker: SQL `add_job`](https://worker.graphile.org/docs/sql-add-job) · [Schema notes](https://worker.graphile.org/docs/schema)
- [pg-boss on npm](https://npmjs.com/package/pg-boss) · [pg-boss dead letter queues (DeepWiki)](https://deepwiki.com/timgit/pg-boss/11.2-dead-letter-queues)
