-- ─────────────────────────────────────────────────────────────────────────────
-- 010: Multi-sense vocabulary
-- A hanzi with multiple distinct CEDICT meanings can now be saved as
-- independent review cards instead of being forced into a single row that
-- silently picks one sense. Keyed by (hanzi, pinyin, meaning) rather than
-- just (hanzi, pinyin) — CEDICT sometimes lists genuinely different senses
-- under the *same* reading (e.g. 打 dǎ covers "to hit", "to make", "dozen",
-- ... as distinct entries), so pinyin alone isn't a reliable differentiator;
-- the English gloss is the one that actually is.
-- ─────────────────────────────────────────────────────────────────────────────

alter table vocabulary_mastery
  drop constraint vocabulary_mastery_user_id_hanzi_key;

alter table vocabulary_mastery
  add constraint vocabulary_mastery_user_id_hanzi_pinyin_meaning_key
  unique (user_id, hanzi, pinyin, meaning);
