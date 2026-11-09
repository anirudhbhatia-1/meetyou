-- 0006 — "Download all my data" (S3-11, FR-SET-04, DESIGN §13.2; Anirudh, 2026-11-09).
--
-- One row per export request. The worker writes a zip of JSON + Markdown to
-- ws/{workspaceId}/exports/{exportId}.zip (ARCHITECTURE §11.4), marks the row ready, and deletes the
-- file 24 hours later (status expired). Rows go with the workspace on account deletion; the
-- account.delete job removes the files.

CREATE TABLE exports (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'preparing'
                 CHECK (status IN ('preparing', 'ready', 'failed', 'expired')),
  storage_key    text,
  size_bytes     bigint CHECK (size_bytes >= 0),
  meeting_count  integer CHECK (meeting_count >= 0),
  ready_at       timestamptz,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'ready' OR (storage_key IS NOT NULL AND ready_at IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX exports_user_recent_idx ON exports (user_id, created_at DESC);

CREATE TRIGGER exports_updated_at BEFORE UPDATE ON exports
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE exports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON exports
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
