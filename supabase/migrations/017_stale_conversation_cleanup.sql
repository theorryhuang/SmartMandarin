-- ─────────────────────────────────────────────────────────────────────────────
-- 017: Auto-delete stale conversations (chat + speaking)
--
-- Neither chat_messages nor speaking_turns tracks a separate "last opened"
-- timestamp — there's no conversations table at all, the conversation list
-- is reconstructed from message rows (see getConversationList() /
-- getSpeakingConversationList()). So "hasn't been opened" is read as "no
-- new message in it" — a conversation whose newest row is 14+ days old.
-- Runs nightly via pg_cron directly in Postgres, independent of whether the
-- Next.js app itself is deployed/running.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron with schema pg_catalog;

create or replace function delete_stale_conversations(p_max_age interval default interval '14 days')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Text chat — delete every message belonging to a conversation whose most
  -- recent message is older than p_max_age. Rows with no conversation_id
  -- (pre-multi-conversation history) are left alone; there's nothing to
  -- group them by, and they're not what "a chat" means here.
  delete from chat_messages cm
  using (
    select conversation_id
    from chat_messages
    where conversation_id is not null
    group by conversation_id
    having max(created_at) < now() - p_max_age
  ) stale
  where cm.conversation_id = stale.conversation_id;

  -- Voice/speaking conversations — same rule.
  delete from speaking_turns st
  using (
    select conversation_id
    from speaking_turns
    where conversation_id is not null
    group by conversation_id
    having max(created_at) < now() - p_max_age
  ) stale
  where st.conversation_id = stale.conversation_id;
end;
$$;

-- Idempotent: cron.schedule() upserts by job name, so rerunning this
-- migration just re-registers the same job rather than duplicating it.
select cron.schedule(
  'nightly-stale-chat-cleanup',
  '0 3 * * *', -- 03:00 UTC daily
  $$select delete_stale_conversations();$$
);
