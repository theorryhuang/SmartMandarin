-- ─────────────────────────────────────────────────────────────────────────────
-- 018: Lock down shared reference tables
--
-- hsk_vocabulary and slang_bank were created without RLS, unlike cedict
-- (007_cedict.sql), which explicitly enables it with a public-read-only
-- policy. Without RLS, access is governed entirely by whatever default
-- Postgres grants Supabase's anon/authenticated roles have on the public
-- schema — on most Supabase projects that includes more than SELECT, which
-- would let any authenticated (or anonymous) caller INSERT/UPDATE/DELETE
-- rows in these shared reference tables directly via PostgREST, no app code
-- involved. Since both are shared across every user, that's not a
-- per-attacker problem — it corrupts the app for everyone.
--
-- Mirrors cedict_public_read exactly: readable by anyone, writable by no
-- one through the API (seeding stays a service-role/migration-only operation).
-- ─────────────────────────────────────────────────────────────────────────────

alter table hsk_vocabulary enable row level security;
alter table slang_bank     enable row level security;

create policy "hsk_vocabulary_public_read" on hsk_vocabulary
  for select using (true);

create policy "slang_bank_public_read" on slang_bank
  for select using (true);
