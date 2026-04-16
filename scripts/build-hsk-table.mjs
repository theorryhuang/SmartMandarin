/**
 * Adds/refreshes the `hsk` table in data/cedict.db.
 * Source: clem109/hsk-vocabulary (HSK 2.0, levels 1–6)
 *
 * Run: node scripts/build-hsk-table.mjs
 */

import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "..", "data", "cedict.db");

const BASE = "https://raw.githubusercontent.com/clem109/hsk-vocabulary/master/hsk-vocab-json";

async function fetchLevel(level) {
  const res = await fetch(`${BASE}/hsk-level-${level}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for level ${level}`);
  return res.json();
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = OFF");

db.exec(`
  DROP TABLE IF EXISTS hsk;
  CREATE TABLE hsk (
    hanzi TEXT PRIMARY KEY,
    level INTEGER NOT NULL
  );
`);

const insert = db.prepare("INSERT OR IGNORE INTO hsk (hanzi, level) VALUES (?, ?)");

let total = 0;
for (let level = 1; level <= 6; level++) {
  process.stdout.write(`  Fetching HSK ${level}...`);
  const words = await fetchLevel(level);
  const run = db.transaction((rows) => {
    for (const w of rows) insert.run(w.hanzi, level);
  });
  run(words);
  total += words.length;
  console.log(` ${words.length} words`);
}

db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
console.log(`Done: ${total} HSK words written to ${dbPath}`);
