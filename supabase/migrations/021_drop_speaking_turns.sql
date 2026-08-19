-- ─────────────────────────────────────────────────────────────────────────────
-- 021: Drop speaking_turns — standalone Speaking Practice page merged into
-- the chatbot (see app/conversation/ConversationClient.tsx). Its push-to-talk
-- flow now writes chat_messages via saveMessages(), same table + server
-- action every other chat turn already uses, so speaking_turns has no writer
-- left and its rows are irrecoverably orphaned history from the old page.
-- ─────────────────────────────────────────────────────────────────────────────

-- Replace the nightly stale-conversation cleanup first, dropping its
-- speaking_turns branch — it must not reference the table being dropped
-- below. The chat_messages branch, and the cron job itself, are unchanged.
create or replace function delete_stale_conversations(p_max_age interval default interval '14 days')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Delete every message belonging to a conversation whose most recent
  -- message is older than p_max_age. Rows with no conversation_id (pre-
  -- multi-conversation history) are left alone; there's nothing to group
  -- them by, and they're not what "a chat" means here.
  delete from chat_messages cm
  using (
    select conversation_id
    from chat_messages
    where conversation_id is not null
    group by conversation_id
    having max(created_at) < now() - p_max_age
  ) stale
  where cm.conversation_id = stale.conversation_id;
end;
$$;

drop table if exists speaking_turns;
