-- CEDICT dictionary table (seeded via scripts/seed-cedict-supabase.mjs)

create table if not exists cedict (
  id         bigserial primary key,
  simplified text not null,
  traditional text not null,
  pinyin     text not null,
  english    text not null
);

create index if not exists idx_cedict_simplified on cedict(simplified);

alter table cedict enable row level security;

create policy "cedict_public_read" on cedict
  for select using (true);
