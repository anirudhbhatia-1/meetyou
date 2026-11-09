-- 0005 — Full-text search indexes (S3-09, ARCHITECTURE §11.5).
--
-- The `simple` configuration lowercases and splits words without stemming, so Roman Hinglish,
-- English and Devanagari text all match word by word. Queries are normalized in code with the same
-- Hinglish spelling list the transcript uses. Search reads only through these expressions, so the
-- index is used; rows stay behind forced RLS like everything else.

CREATE INDEX transcript_segments_fts_idx ON transcript_segments
  USING gin (to_tsvector('simple', text));
CREATE INDEX notes_fts_idx ON notes USING gin (to_tsvector('simple', text));
CREATE INDEX summary_items_fts_idx ON summary_items USING gin (to_tsvector('simple', text));
