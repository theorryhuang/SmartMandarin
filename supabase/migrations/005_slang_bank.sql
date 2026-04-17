-- ─────────────────────────────────────────────────────────────────────────────
-- SmartMandarin — Slang / 口语 Dictionary
-- Separate table for colloquial/slang terms not in formal CEDICT
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists slang_bank (
  id           uuid primary key default gen_random_uuid(),
  hanzi        text not null unique,
  pinyin       text,
  meaning      text not null,
  category     text,  -- 'internet', 'spoken', 'regional', 'abbreviation', etc.
  example      text,  -- usage context/example
  notes        text,
  source       text,  -- 'popcidian', 'user', etc.
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_slang_bank_hanzi on slang_bank(hanzi);
create index if not exists idx_slang_bank_category on slang_bank(category);

-- Automatically bump updated_at on every row update
create trigger slang_bank_updated_at
  before update on slang_bank
  for each row execute procedure set_updated_at();
