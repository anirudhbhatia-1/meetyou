-- 0007 — Speaker naming and the batch pass (S3-04, FR-SPK-03; Anirudh, 2026-11-09).
--
-- The Meet adapter reports who is in the call (participant.joined) and who is talking
-- (speaker.active). Participants keep Meet's own ID for the call so repeated events update one row;
-- speaker signals are stored as they arrive and joined to participants by that ID when the batch
-- pass names diarized clusters. Meet's IDs are per call (no identity across meetings, FR-SPK-06),
-- like display names they are user content and never logged (AGENTS §7).

ALTER TABLE participants ADD COLUMN external_id text;
CREATE UNIQUE INDEX participants_external_idx ON participants (meeting_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE speaker_signals (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL,
  meeting_id    text NOT NULL,
  external_id   text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 200),
  -- Session clock (ARCHITECTURE §5.5).
  at_ms         bigint NOT NULL CHECK (at_ms >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (meeting_id, workspace_id) REFERENCES meetings (id, workspace_id) ON DELETE CASCADE,
  -- A resent event after a reconnect is the same signal.
  UNIQUE (meeting_id, external_id, at_ms)
);
CREATE INDEX speaker_signals_meeting_idx ON speaker_signals (meeting_id, at_ms);

CREATE TRIGGER speaker_signals_updated_at BEFORE UPDATE ON speaker_signals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE speaker_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE speaker_signals FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON speaker_signals
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
