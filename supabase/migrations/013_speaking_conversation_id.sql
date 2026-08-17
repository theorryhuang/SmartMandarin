-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-conversation support for speaking_turns — mirrors 008_conversation_id.sql
-- (chat_messages). Client-generated text id (e.g. "sconv_<timestamp>"), not a
-- separate conversations table — same reasoning as chat: the conversation
-- list is reconstructed from these rows (see getSpeakingConversationList()).
-- ─────────────────────────────────────────────────────────────────────────────

alter table speaking_turns add column if not exists conversation_id text;

create index if not exists idx_speaking_turns_conv
  on speaking_turns (user_id, conversation_id, created_at desc);
