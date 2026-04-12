-- ─────────────────────────────────────────────────────────────────────────────
-- SmartMandarin — Initial Schema
-- Run via: supabase db push  OR paste into the Supabase SQL editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── vocabulary_mastery ───────────────────────────────────────────────────────
-- One row per (user, word).  The FSRS columns are updated after every review.

create table if not exists vocabulary_mastery (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,

  -- Word data
  hanzi                    text not null,
  pinyin                   text not null,
  meaning                  text not null,

  -- HSK level stored as float:
  --   3.0 = start of HSK 3 vocabulary
  --   3.9 = top of HSK 3, nearly promoted
  hsk_level                numeric(4,2) not null default 1.0,

  -- FSRS parameters
  -- stability: days until retrievability drops to 90%
  -- A brand-new unseen word is initialised to 0; set on first review.
  stability                numeric(10,4) not null default 0,
  difficulty               numeric(6,4) not null default 5.0, -- [1, 10]

  -- Scheduling
  last_reviewed            timestamptz,
  next_review              timestamptz,
  review_count             int not null default 0,

  -- Register / mode flags
  is_slang                 boolean not null default false,
  flagged_for_immediate_use boolean not null default false,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (user_id, hanzi)
);

-- Automatically bump updated_at on every row update
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger vocabulary_mastery_updated_at
  before update on vocabulary_mastery
  for each row execute procedure set_updated_at();


-- ─── review_log ───────────────────────────────────────────────────────────────
-- Append-only audit trail.  Never mutate; always insert.

create table if not exists review_log (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  word_id           uuid not null references vocabulary_mastery(id) on delete cascade,

  -- 1=Again, 2=Hard, 3=Good, 4=Easy
  rating            smallint not null check (rating between 1 and 4),

  stability_before  numeric(10,4) not null,
  stability_after   numeric(10,4) not null,
  difficulty_before numeric(6,4)  not null,
  difficulty_after  numeric(6,4)  not null,

  -- Retrievability at the moment of review (0–1)
  retrievability    numeric(8,6)  not null,

  reviewed_at       timestamptz not null default now(),

  -- Where the review was triggered from
  source            text not null check (source in ('conversation', 'reader', 'review_session'))
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Fetch due cards quickly (ordered by next_review ascending)
create index if not exists idx_vocab_due
  on vocabulary_mastery (user_id, next_review asc nulls first)
  where next_review is not null;

-- Immediately-flagged words rise to the top of any queue
create index if not exists idx_vocab_flagged
  on vocabulary_mastery (user_id, flagged_for_immediate_use)
  where flagged_for_immediate_use = true;

-- Level-based filtering for injection logic
create index if not exists idx_vocab_level
  on vocabulary_mastery (user_id, hsk_level);

-- Audit lookups by word
create index if not exists idx_review_log_word
  on review_log (word_id, reviewed_at desc);


-- ─── Row-Level Security ───────────────────────────────────────────────────────

alter table vocabulary_mastery enable row level security;
alter table review_log         enable row level security;

-- Users can only see and modify their own rows
create policy "users_own_vocabulary"
  on vocabulary_mastery
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users_own_review_log"
  on review_log
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ─── Helper Functions ─────────────────────────────────────────────────────────

-- Atomically increments review_count (avoids race in server actions)
create or replace function increment_review_count(word_id uuid)
returns void language sql security definer as $$
  update vocabulary_mastery
  set review_count = review_count + 1
  where id = word_id;
$$;

-- Returns words due for review, flagged words first, then by next_review.
create or replace function get_due_words(p_user_id uuid, p_limit int default 20)
returns setof vocabulary_mastery
language sql stable security definer as $$
  select *
  from vocabulary_mastery
  where user_id = p_user_id
    and (
      flagged_for_immediate_use = true
      or next_review <= now()
      or next_review is null        -- never-reviewed words
    )
  order by
    flagged_for_immediate_use desc, -- urgent words first
    next_review asc nulls first     -- then oldest due date
  limit p_limit;
$$;

-- Returns HSK-level mastery statistics used by the injection logic.
create or replace function get_hsk_level_stats(p_user_id uuid)
returns table (
  level               int,
  total               bigint,
  high_stability_count bigint,
  mastery_ratio       numeric
)
language sql stable security definer as $$
  select
    floor(hsk_level)::int                          as level,
    count(*)                                       as total,
    count(*) filter (where stability >= 21)        as high_stability_count,
    round(
      count(*) filter (where stability >= 21)::numeric
      / nullif(count(*), 0),
      4
    )                                              as mastery_ratio
  from vocabulary_mastery
  where user_id = p_user_id
  group by floor(hsk_level)
  order by level;
$$;
