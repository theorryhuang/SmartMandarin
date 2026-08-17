-- ─────────────────────────────────────────────────────────────────────────────
-- Per-user Gemini API keys (BYOK) — lets each user supply their own key so
-- their usage isn't rate-limited against everyone else sharing the app's
-- default key. Encrypted at the application layer before it ever reaches
-- Postgres (see lib/crypto/secret.ts) — this column only ever holds
-- ciphertext, never a usable key.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists user_settings (
  user_id                     uuid primary key references auth.users(id) on delete cascade,

  gemini_api_key_encrypted    text,          -- app-layer encrypted, opaque to Postgres
  gemini_api_key_last4        text,          -- last 4 chars, plaintext, for display only

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger user_settings_updated_at
  before update on user_settings
  for each row execute procedure set_updated_at(); -- reuses the function from 001

alter table user_settings enable row level security;

create policy "users_own_settings"
  on user_settings
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
