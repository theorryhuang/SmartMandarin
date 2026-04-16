-- ─────────────────────────────────────────────────────────────────────────────
-- SmartMandarin — Speaking Turns
-- Stores voice conversation turns; localStorage keeps the last 60.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists speaking_turns (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- Matches the client-side ConversationTurn interface
  client_id   text not null,                          -- turn.timestamp (ISO string)
  role        text not null check (role in ('user', 'assistant')),
  raw_text    text not null,
  tokens      jsonb not null default '[]',

  created_at  timestamptz not null default now(),

  unique (user_id, client_id)
);

-- Fast fetch of recent turns for a user
create index if not exists idx_speaking_turns_user_created
  on speaking_turns (user_id, created_at desc);

-- Row-Level Security
alter table speaking_turns enable row level security;

create policy "users_own_speaking_turns"
  on speaking_turns
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
