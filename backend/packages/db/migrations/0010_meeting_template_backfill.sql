-- 0010 — Backfill meetings.template from the kept notes (Anirudh, 2026-11-10).
--
-- Until 2026-11-09 keeping a rewritten version (e.g. MoM) left the meeting's own template unchanged,
-- so the Meetings filter and list label still said "General". `acceptSummary` now updates it; this
-- fixes the meetings kept before that. Data only, no schema change.
--
-- Row-level security is forced on both tables, so even their owner (the role running migrations)
-- would see no rows without a workspace. It is lifted for this one statement and restored in the
-- same transaction (each migration runs in its own transaction, migrate.ts).

ALTER TABLE meetings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE summaries NO FORCE ROW LEVEL SECURITY;

UPDATE meetings m
SET template = s.template
FROM summaries s
WHERE s.meeting_id = m.id
  AND s.workspace_id = m.workspace_id
  AND s.accepted
  AND s.template <> m.template;

ALTER TABLE summaries FORCE ROW LEVEL SECURITY;
ALTER TABLE meetings FORCE ROW LEVEL SECURITY;
