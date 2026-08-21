-- ─────────────────────────────────────────────────────────────────────────────
-- 024: Cache example sentences per word, not per batch-row
--
-- example_sentences (016) was cached on daily_learning_words — one row per
-- (batch, word). A word that gets carried over after failing its quiz, or
-- re-added via "add more", gets a brand-new daily_learning_words row with a
-- blank cache, so it regenerates from scratch every time it reappears. That
-- burns GEMINI_USE_CASE_MODEL's tight 5/min · 20/day cap fast (see
-- app/actions/dailyLearning.ts), which is what was actually surfacing as
-- the raw Gemini/quota errors on repeat words.
--
-- Moves the cache to a table keyed by word_id (still deliberately not on
-- vocabulary_mastery itself — this is scratch reference material for the
-- daily-learning flow, not part of the saved vocab list) so any reappearance
-- of the same word reuses whatever was already generated for it.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists daily_word_examples (
  word_id     uuid primary key references vocabulary_mastery(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  examples    jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_daily_word_examples_user
  on daily_word_examples (user_id);

alter table daily_word_examples enable row level security;

create policy "users_own_daily_word_examples"
  on daily_word_examples
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Carry forward anything already generated under the old per-row column
-- instead of throwing it away and regenerating on next view.
insert into daily_word_examples (word_id, user_id, examples)
select word_id, user_id, example_sentences
from daily_learning_words
where example_sentences is not null
on conflict (word_id) do nothing;

alter table daily_learning_words drop column if exists example_sentences;
