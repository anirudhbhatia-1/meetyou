-- 0009 — "Minutes of meeting (MoM)" summary template (Anirudh, 2026-11-09).
--
-- A new template id `minutes` (shared/contracts TemplateId, summarizer TEMPLATES). The three CHECK
-- constraints that list template ids are widened; existing rows are unaffected.

ALTER TABLE user_settings
  DROP CONSTRAINT user_settings_default_template_check,
  ADD CONSTRAINT user_settings_default_template_check
    CHECK (default_template IN ('general', 'standup', 'client_call', 'interview', 'one_on_one', 'minutes'));

ALTER TABLE meetings
  DROP CONSTRAINT meetings_template_check,
  ADD CONSTRAINT meetings_template_check
    CHECK (template IN ('general', 'standup', 'client_call', 'interview', 'one_on_one', 'minutes'));

ALTER TABLE summaries
  DROP CONSTRAINT summaries_template_check,
  ADD CONSTRAINT summaries_template_check
    CHECK (template IN ('general', 'standup', 'client_call', 'interview', 'one_on_one', 'minutes'));
