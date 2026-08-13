-- ─────────────────────────────────────────────────────────────────────────────
-- Extension tokens — personal access tokens for the browser extension
-- (popup dictionary on third-party pages). Bearer-token auth: the extension
-- can't send the user's Supabase session cookie cross-origin, so it presents
-- one of these instead. Raw token is shown once at creation time and never
-- stored — only its SHA-256 hash lives here, looked up on every request.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists extension_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  token_hash    text not null unique,
  label         text not null default 'Browser extension',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists extension_tokens_hash_idx on extension_tokens(token_hash);
create index if not exists extension_tokens_user_idx on extension_tokens(user_id);

alter table extension_tokens enable row level security;

-- Users manage their own tokens through normal cookie-authenticated requests
-- (the settings page). Token *verification* for extension API calls happens
-- server-side via the service-role key, which bypasses RLS entirely.
create policy "Users can view their own extension tokens"
  on extension_tokens for select
  using (auth.uid() = user_id);

create policy "Users can delete their own extension tokens"
  on extension_tokens for delete
  using (auth.uid() = user_id);

create policy "Users can create their own extension tokens"
  on extension_tokens for insert
  with check (auth.uid() = user_id);
