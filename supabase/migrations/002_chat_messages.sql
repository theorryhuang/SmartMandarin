-- ─────────────────────────────────────────────────────────────────────────────
-- SmartMandarin — Chat Messages
-- Stores all chat messages; localStorage keeps only the last 100.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists chat_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- Matches the client-side Message interface
  client_id   text not null,           -- the id string used in the UI
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,

  created_at  timestamptz not null default now(),

  unique (user_id, client_id)
);

-- Fast fetch of recent messages for a user
create index if not exists idx_chat_messages_user_created
  on chat_messages (user_id, created_at desc);

-- Row-Level Security
alter table chat_messages enable row level security;

create policy "users_own_chat_messages"
  on chat_messages
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
