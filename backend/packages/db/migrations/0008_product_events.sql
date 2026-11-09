-- 0008 — Product analytics events (S4-15, PRD §19.2/§19.6, FEATURES O5; Anirudh, 2026-11-09).
--
-- Our own store instead of an analytics vendor (decision 2026-11-09). The API validates every event
-- against its typed schema (shared/contracts analytics.ts): IDs, counts, durations and enums only,
-- never transcript text, notes, names or titles. Nothing is stored for a user who opted out
-- (user_settings.analytics_opt_out). Rows go with the workspace or user on account deletion.

CREATE TABLE product_events (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client        text NOT NULL CHECK (client IN ('web', 'extension')),
  name          text NOT NULL CHECK (name ~ '^[a-z_]{1,40}$'),
  props         jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_events_name_idx ON product_events (name, occurred_at);
CREATE INDEX product_events_user_idx ON product_events (user_id, occurred_at);

CREATE TRIGGER product_events_updated_at BEFORE UPDATE ON product_events
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON product_events
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
