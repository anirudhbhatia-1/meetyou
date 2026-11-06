-- 0003 — Dead-letter record for background jobs (ADR-0005 §3.1, S2-06).
--
-- One row per job that failed all its attempts, written from the worker's `job:failed` event, so
-- graphile-worker's own tables are never read by application code. Content-free: task name, IDs,
-- attempt count and the error's name only (AGENTS §7). The application may insert but not read
-- these rows (forced RLS with an insert-only policy); operators read them for alerts.

CREATE TABLE failed_jobs (
  id            text PRIMARY KEY,
  -- From the job payload when it names a workspace; kept (NULL) if the workspace is deleted.
  workspace_id  text REFERENCES workspaces (id) ON DELETE SET NULL,
  task          text NOT NULL CHECK (char_length(task) <= 100),
  job_id        text NOT NULL,
  job_key       text,
  attempts      integer NOT NULL CHECK (attempts >= 0),
  error_code    text NOT NULL CHECK (char_length(error_code) <= 100),
  failed_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX failed_jobs_failed_at_idx ON failed_jobs (failed_at DESC);

ALTER TABLE failed_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY record_failure ON failed_jobs FOR INSERT WITH CHECK (true);
