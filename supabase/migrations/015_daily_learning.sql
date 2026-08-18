-- ─────────────────────────────────────────────────────────────────────────────
-- 015: Daily vocab learning
--
-- A separate program from the FSRS review queue: each day the user picks a
-- word count x, and gets assigned the x easiest not-yet-learned words
-- (lowest HSK level first, pinyin alphabetical as tiebreak). The next time
-- they visit, they're quizzed (sentence-building) on the previous
-- unresolved day's words before a new batch can be built — words they fail
-- carry into the new batch instead of being replaced, so "x words" always
-- means x words total, not x new words.
-- ─────────────────────────────────────────────────────────────────────────────

alter table vocabulary_mastery
  add column if not exists daily_learned boolean not null default false;

-- Ordering the "not yet learned" pool by level/pinyin.
create index if not exists idx_vocab_daily_unlearned
  on vocabulary_mastery (user_id, hsk_level, pinyin)
  where daily_learned = false;

-- ─── daily_learning_batches ─────────────────────────────────────────────────
-- One row per (user, calendar day) they built a learning set.

create table if not exists daily_learning_batches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  batch_date    date not null,
  target_count  int not null,
  created_at    timestamptz not null default now(),

  unique (user_id, batch_date)
);

-- ─── daily_learning_words ───────────────────────────────────────────────────
-- One row per word assigned to a batch. Status starts 'pending' (being
-- learned that day) and is resolved to 'passed'/'failed' when quizzed on a
-- later visit. 'carried_over' marks words re-added after a failed quiz.

create table if not exists daily_learning_words (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references daily_learning_batches(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  word_id       uuid not null references vocabulary_mastery(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'passed', 'failed')),
  carried_over  boolean not null default false,
  quizzed_at    timestamptz,
  created_at    timestamptz not null default now(),

  unique (batch_id, word_id)
);

create index if not exists idx_daily_words_batch
  on daily_learning_words (batch_id);

create index if not exists idx_daily_words_status
  on daily_learning_words (user_id, status);

-- Fetching the latest attempt per word (to decide what's still outstanding).
create index if not exists idx_daily_words_word_recency
  on daily_learning_words (user_id, word_id, created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table daily_learning_batches enable row level security;
alter table daily_learning_words   enable row level security;

create policy "users_own_daily_batches"
  on daily_learning_batches
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_own_daily_words"
  on daily_learning_words
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
