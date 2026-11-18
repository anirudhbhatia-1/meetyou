-- 0011 — Folders and folder suggestions (DESIGN §11.1–11.2; Anirudh, 2026-11-18).
--
-- A meeting is in at most one folder of its workspace. Deleting a folder unfiles its meetings
-- (`ON DELETE SET NULL (folder_id)`: only the folder column, the workspace column stays; Postgres
-- 15+, PGlite and Supabase both qualify). The AI may suggest one existing folder after the first
-- notes; `folder_suggestion` records that it was decided (suggested, none, dismissed), so the job
-- runs once per meeting and a dismissed suggestion never comes back.

CREATE TABLE folders (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  created_by    text REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);
CREATE UNIQUE INDEX folders_name_idx ON folders (workspace_id, lower(name));

CREATE TRIGGER folders_updated_at BEFORE UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON folders
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE meetings
  ADD COLUMN folder_id text,
  ADD COLUMN suggested_folder_id text,
  ADD COLUMN folder_suggestion text CHECK (folder_suggestion IN ('suggested', 'none', 'dismissed')),
  ADD CONSTRAINT meetings_folder_fk FOREIGN KEY (folder_id, workspace_id)
    REFERENCES folders (id, workspace_id) ON DELETE SET NULL (folder_id),
  ADD CONSTRAINT meetings_suggested_folder_fk FOREIGN KEY (suggested_folder_id, workspace_id)
    REFERENCES folders (id, workspace_id) ON DELETE SET NULL (suggested_folder_id);
CREATE INDEX meetings_folder_idx ON meetings (workspace_id, folder_id, started_at DESC)
  WHERE deleted_at IS NULL;
