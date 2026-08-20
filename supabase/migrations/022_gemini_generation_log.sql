-- ─────────────────────────────────────────────────────────────────────────────
-- 022: Gemini generation rate limiting
--
-- Backs an app-side quota check in front of the daily-learning use-case
-- generator (Gemini 3.7 Flash), which has a tight free-tier quota. Caps are
-- per *distinct word*, not per raw API call: regenerating a word that's
-- already been generated today (a "repeat" — e.g. re-opening it, or hitting
-- the debug regenerate button) is free and never counts against either
-- limit; only a genuinely new word does. Without that distinction, a single
-- word needing a couple of internal retries (see validate() in
-- app/actions/dailyLearning.ts) would burn multiple slots of a cap that's
-- supposed to mean "20 words," not "20 API calls."
--
-- `purpose` is a free-text tag (currently just 'daily_use_cases') and
-- `word_id` the vocabulary_mastery row it was for, so this table can back
-- other rate-limited generation features later without a new table each
-- time; word_id is nullable for any future purpose that isn't word-scoped.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists gemini_generation_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  purpose     text not null,
  word_id     uuid references vocabulary_mastery(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists idx_gemini_generation_log_lookup
  on gemini_generation_log (user_id, purpose, created_at desc);

alter table gemini_generation_log enable row level security;

create policy "users_own_gemini_generation_log"
  on gemini_generation_log
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── check_and_log_gemini_generation ───────────────────────────────────────────
-- For `p_word_id`: if it already has a log row for `p_purpose` within the
-- last 24h, this call is a free repeat — return immediately, no new row, no
-- effect on either cap. Otherwise checks the caller's distinct-word counts
-- for the last minute and last 24h against the given limits, and only if
-- both pass, logs this word and returns. Raises a distinct exception
-- message per limit so the caller can show the right one.
--
-- Not fully race-proof under true concurrency (two simultaneous calls for
-- two different new words could both read the same under-limit count
-- before either inserts) — acceptable here since this guards a single-user
-- hobby app's own proactive UX check, not the actual enforcement boundary;
-- Gemini's real 429 is the hard backstop either way.
create or replace function check_and_log_gemini_generation(
  p_purpose text,
  p_word_id uuid,
  p_rpm_limit int,
  p_rpd_limit int
)
returns void
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_already_today boolean;
  v_day_word_count int;
  v_minute_word_count int;
begin
  if v_user_id is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  select exists(
    select 1 from gemini_generation_log
    where user_id = v_user_id
      and purpose = p_purpose
      and word_id = p_word_id
      and created_at >= now() - interval '1 day'
  ) into v_already_today;

  if v_already_today then
    return; -- repeat — free, doesn't touch either cap
  end if;

  select count(distinct word_id) into v_day_word_count
  from gemini_generation_log
  where user_id = v_user_id
    and purpose = p_purpose
    and created_at >= now() - interval '1 day';

  if v_day_word_count >= p_rpd_limit then
    raise exception 'DAILY_LIMIT_REACHED';
  end if;

  select count(distinct word_id) into v_minute_word_count
  from gemini_generation_log
  where user_id = v_user_id
    and purpose = p_purpose
    and created_at >= now() - interval '1 minute';

  if v_minute_word_count >= p_rpm_limit then
    raise exception 'RATE_LIMIT_MINUTE';
  end if;

  insert into gemini_generation_log (user_id, purpose, word_id) values (v_user_id, p_purpose, p_word_id);
end;
$$;

revoke all on function check_and_log_gemini_generation(text, uuid, int, int) from public;
grant execute on function check_and_log_gemini_generation(text, uuid, int, int) to authenticated;
