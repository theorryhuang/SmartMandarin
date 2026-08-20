-- ─────────────────────────────────────────────────────────────────────────────
-- 023: Split gemini quota check from logging
--
-- check_and_log_gemini_generation (022) inserted its log row *before* the
-- caller ever made the actual Gemini call — meaning a call that fails
-- outright (bad request, timeout, bad JSON) still burned a real slot of
-- the daily/per-minute cap for nothing. That's exactly what happened when
-- Gemini 3.7 Flash's thinking_level mismatch (fixed in app/actions/
-- dailyLearning.ts) made every use-case-generation call 400 during testing.
--
-- Splits into two functions: check_gemini_generation_quota (read-only,
-- called before the Gemini call — still returns early/free for a repeat
-- word already logged today) and log_gemini_generation (insert-only,
-- called only once the generation actually succeeded). The repeat-is-free
-- behavior is unchanged; only successful generations now count at all.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists check_and_log_gemini_generation(text, uuid, int, int);

create function check_gemini_generation_quota(
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
end;
$$;

revoke all on function check_gemini_generation_quota(text, uuid, int, int) from public;
grant execute on function check_gemini_generation_quota(text, uuid, int, int) to authenticated;

create function log_gemini_generation(p_purpose text, p_word_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'NOT_SIGNED_IN';
  end if;

  insert into gemini_generation_log (user_id, purpose, word_id) values (v_user_id, p_purpose, p_word_id);
end;
$$;

revoke all on function log_gemini_generation(text, uuid) from public;
grant execute on function log_gemini_generation(text, uuid) to authenticated;

-- ─── One-off cleanup ──────────────────────────────────────────────────────────
-- Every row logged so far was from testing the (now-fixed) thinking_level
-- bug — every one of those calls failed outright, none produced a real
-- generation. Clearing them gives a clean slate against the new caps
-- instead of leaving the day's quota pre-burned by calls that never
-- actually worked.
delete from gemini_generation_log where purpose = 'daily_use_cases';
