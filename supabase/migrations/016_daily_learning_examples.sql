-- ─────────────────────────────────────────────────────────────────────────────
-- 016: Cached example sentences for daily learning words
--
-- Generated on-demand (Gemini) the first time a user asks to see example
-- sentences for a word in today's/yesterday's daily batch, then cached here
-- so re-viewing it later the same day doesn't regenerate. Deliberately NOT
-- copied onto vocabulary_mastery — this is scratch reference material for
-- the daily-learning flow, not part of the saved vocab list.
-- ─────────────────────────────────────────────────────────────────────────────

alter table daily_learning_words
  add column if not exists example_sentences jsonb;
