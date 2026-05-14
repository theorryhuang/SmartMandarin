alter table chat_messages add column if not exists conversation_id text;

create index if not exists idx_chat_messages_conv
  on chat_messages (user_id, conversation_id, created_at desc);
