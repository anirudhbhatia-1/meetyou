-- 0004 — "Ask this meeting" (Anirudh, 2026-11-07; FEATURES E4 pulled into Phase 1, AGENTS §9).
--
-- One row per answered question about one meeting. Rows live in the meeting's workspace (forced
-- RLS, like every other table), so a question can only be asked of, and read back from, the
-- owner's own recordings. They are deleted with the meeting. The same rows count toward the
-- per-user hourly and daily limits. Question and answer are user content, like notes: they never
-- appear in logs (AGENTS §7).

CREATE TABLE meeting_questions (
  id               text PRIMARY KEY,
  workspace_id     text NOT NULL,
  meeting_id       text NOT NULL,
  user_id          text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question         text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 500),
  -- answered: grounded answer with citations; not_in_meeting: about the meeting, but it does not
  -- say; off_topic: not about this meeting (refused, still counted toward the limits).
  status           text NOT NULL CHECK (status IN ('answered', 'not_in_meeting', 'off_topic')),
  answer           text CHECK (char_length(answer) <= 4000),
  -- Only IDs of this meeting's segments; checked in code before insert (AGENTS §3 rule 7).
  segment_ids      text[] NOT NULL DEFAULT '{}',
  model            text NOT NULL,
  input_tokens     bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens    bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  thinking_tokens  bigint NOT NULL DEFAULT 0 CHECK (thinking_tokens >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'answered') = (answer IS NOT NULL)),
  FOREIGN KEY (meeting_id, workspace_id) REFERENCES meetings (id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX meeting_questions_meeting_idx ON meeting_questions (meeting_id, created_at);
CREATE INDEX meeting_questions_user_recent_idx ON meeting_questions (user_id, created_at DESC);

CREATE TRIGGER meeting_questions_updated_at BEFORE UPDATE ON meeting_questions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
ALTER TABLE meeting_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON meeting_questions
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
