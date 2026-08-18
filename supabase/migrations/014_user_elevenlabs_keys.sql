-- ─────────────────────────────────────────────────────────────────────────────
-- Per-user ElevenLabs API keys (BYOK), mirroring 012_user_gemini_keys.sql.
-- Unlike Gemini, there's still a project-wide ELEVENLABS_API_KEY fallback
-- (see lib/elevenlabs/resolveKey.ts) — this doesn't replace it, just lets a
-- user opt into their own key/quota instead of sharing the app's.
-- Encrypted at the application layer before it ever reaches Postgres (see
-- lib/crypto/secret.ts) — this column only ever holds ciphertext.
-- ─────────────────────────────────────────────────────────────────────────────

alter table user_settings
  add column if not exists elevenlabs_api_key_encrypted text,   -- app-layer encrypted, opaque to Postgres
  add column if not exists elevenlabs_api_key_last4      text;  -- last 4 chars, plaintext, for display only
