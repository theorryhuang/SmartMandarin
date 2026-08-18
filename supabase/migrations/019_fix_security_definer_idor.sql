-- ─────────────────────────────────────────────────────────────────────────────
-- 019: Fix IDOR in security definer functions
--
-- get_due_words, get_hsk_level_stats, and increment_review_count are all
-- `security definer` — they run with elevated privilege that bypasses RLS
-- entirely, and their only protection was `where user_id = p_user_id` /
-- `where id = word_id`, trusting a caller-supplied parameter that was never
-- checked against who's actually signed in. Any authenticated caller could
-- hit the RPC endpoint directly with someone else's user_id and read their
-- vocabulary, or an arbitrary word_id and corrupt someone else's row.
--
-- Fix: derive the caller's identity from auth.uid() *inside* the function
-- (which correctly reflects the real caller even under security definer —
-- it reads the request's JWT claims, not the executing role) instead of
-- trusting a parameter. get_due_words/get_hsk_level_stats drop p_user_id
-- entirely since callers always want their own id anyway; there's no
-- legitimate reason to keep it as an argument at all.
--
-- delete_stale_conversations is different: it's *supposed* to be unscoped
-- (the whole point is deleting stale rows across every user). The fix there
-- isn't logic, it's access — revoke EXECUTE from anon/authenticated so it's
-- only reachable by pg_cron and the service-role client, never by a
-- regular signed-in user hitting the RPC endpoint directly.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── get_due_words ──────────────────────────────────────────────────────────

drop function if exists get_due_words(uuid, int);

create function get_due_words(p_limit int default 20)
returns setof vocabulary_mastery
language sql stable security definer as $$
  select *
  from vocabulary_mastery
  where user_id = auth.uid()
    and (
      flagged_for_immediate_use = true
      or next_review <= now()
      or next_review is null
    )
  order by
    flagged_for_immediate_use desc,
    next_review asc nulls first
  limit p_limit;
$$;

revoke all on function get_due_words(int) from public;
grant execute on function get_due_words(int) to authenticated;

-- ─── get_hsk_level_stats ────────────────────────────────────────────────────

drop function if exists get_hsk_level_stats(uuid);

create function get_hsk_level_stats()
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
  where user_id = auth.uid()
  group by floor(hsk_level)
  order by level;
$$;

revoke all on function get_hsk_level_stats() from public;
grant execute on function get_hsk_level_stats() to authenticated;

-- ─── increment_review_count ─────────────────────────────────────────────────
-- Same signature (still needs word_id — there's no way to derive that one),
-- just adds the ownership check that was missing.

create or replace function increment_review_count(word_id uuid)
returns void language sql security definer as $$
  update vocabulary_mastery
  set review_count = review_count + 1
  where id = word_id
    and user_id = auth.uid();
$$;

revoke all on function increment_review_count(uuid) from public;
grant execute on function increment_review_count(uuid) to authenticated;

-- ─── delete_stale_conversations ─────────────────────────────────────────────
-- Unscoped by design — lock down who can call it instead of changing what
-- it does. pg_cron and the service-role client both execute as roles this
-- revoke doesn't touch.

revoke all on function delete_stale_conversations(interval) from public, anon, authenticated;
grant execute on function delete_stale_conversations(interval) to service_role;
