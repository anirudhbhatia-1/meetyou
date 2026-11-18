-- 0012 — Google Calendar sync (ADR-0013, DESIGN §10.1, §15.7; Anirudh, 2026-11-18).
--
-- Sync polls a window (yesterday to two days ahead) instead of sync tokens, which Google does not
-- allow together with a time window; `synced_at` marks the events the last poll returned, so an
-- event moved out of the window stops showing without losing the notes written for it.
--
-- Opt-in per user: a connection holds the Google refresh token sealed with AES-256-GCM
-- (`auth/sealed.ts`, keys in Key Vault), never in plain text. Synced events keep only what the
-- product shows or uses: title, times, the Meet code and the attendees (names and emails, user
-- content: never logged). Notes written before a call belong to the event and are copied into the
-- meeting when its recording starts. Disconnecting deletes the connection and, by cascade, its
-- events and their notes.

CREATE TABLE calendar_connections (
  id                    text PRIMARY KEY,
  workspace_id          text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id               text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider              text NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  -- The Google account the calendar belongs to (shown in Settings).
  account_email         text NOT NULL CHECK (char_length(account_email) BETWEEN 3 AND 320),
  refresh_token_sealed  text NOT NULL,
  scope                 text NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reconnect')),
  last_synced_at        timestamptz,
  last_error_code       text CHECK (char_length(last_error_code) <= 64),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  -- One calendar per person for now.
  UNIQUE (workspace_id, user_id)
);

CREATE TABLE calendar_events (
  id             text PRIMARY KEY,
  workspace_id   text NOT NULL,
  connection_id  text NOT NULL,
  -- Google's event ID (an instance ID for recurring events; singleEvents=true).
  external_id    text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 1024),
  title          text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  -- abc-defg-hij from the event's Google Meet link; null for events without one.
  meet_code      text CHECK (meet_code ~ '^[a-z]{3}-[a-z]{4}-[a-z]{3}$'),
  -- [{ name, email, self, organizer }], at most 100.
  attendees      jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id, workspace_id)
    REFERENCES calendar_connections (id, workspace_id) ON DELETE CASCADE,
  UNIQUE (id, workspace_id),
  UNIQUE (connection_id, external_id)
);
CREATE INDEX calendar_events_upcoming_idx ON calendar_events (workspace_id, starts_at);
CREATE INDEX calendar_events_meet_idx ON calendar_events (workspace_id, meet_code, starts_at)
  WHERE meet_code IS NOT NULL;

CREATE TABLE calendar_event_notes (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL,
  event_id      text NOT NULL,
  text          text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  "order"       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (event_id, workspace_id)
    REFERENCES calendar_events (id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX calendar_event_notes_event_idx ON calendar_event_notes (event_id, "order");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['calendar_connections', 'calendar_events', 'calendar_event_notes'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
      t || '_updated_at', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I USING (workspace_id = app_workspace_id()) '
      'WITH CHECK (workspace_id = app_workspace_id())', t);
  END LOOP;
END $$;

-- The recording made on a calendar meeting (title, names before the call, notes before the call).
ALTER TABLE meetings
  ADD COLUMN calendar_event_id text,
  ADD CONSTRAINT meetings_calendar_event_fk FOREIGN KEY (calendar_event_id, workspace_id)
    REFERENCES calendar_events (id, workspace_id) ON DELETE SET NULL (calendar_event_id);
