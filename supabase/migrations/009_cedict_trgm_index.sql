CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS cedict_simplified_trgm ON cedict USING gin(simplified gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cedict_pinyin_trgm ON cedict USING gin(pinyin gin_trgm_ops);
