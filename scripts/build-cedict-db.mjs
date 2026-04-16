/**
 * Build script: converts data/cedict.txt → data/cedict.db (SQLite)
 *
 * CEDICT line format:
 *   TRADITIONAL SIMPLIFIED [PINYIN] /ENGLISH 1/ENGLISH 2/.../
 *
 * Run: node scripts/build-cedict-db.mjs
 */

import Database from "better-sqlite3";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcPath = join(root, "data", "cedict.txt");
const dbPath = join(root, "data", "cedict.db");

console.log("Building CEDICT SQLite database...");
console.log("  Source:", srcPath);
console.log("  Output:", dbPath);

const db = new Database(dbPath);

// WAL mode for faster writes; we'll close and reopen in default mode after build
db.pragma("journal_mode = WAL");
db.pragma("synchronous = OFF");

db.exec(`
  DROP TABLE IF EXISTS entries;
  CREATE TABLE entries (
    id         INTEGER PRIMARY KEY,
    simplified TEXT NOT NULL,
    traditional TEXT NOT NULL,
    pinyin     TEXT NOT NULL,
    english    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_simplified ON entries(simplified);
`);

const insert = db.prepare(
  "INSERT INTO entries (simplified, traditional, pinyin, english) VALUES (?, ?, ?, ?)"
);

// CEDICT line regex: TRADITIONAL SIMPLIFIED [PINYIN] /ENGLISH/
const LINE_RE = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/;

let count = 0;
let skipped = 0;

const insertMany = db.transaction((lines) => {
  for (const line of lines) {
    const m = LINE_RE.exec(line);
    if (!m) { skipped++; continue; }
    const [, traditional, simplified, pinyin, english] = m;
    insert.run(simplified, traditional, pinyin, english);
    count++;
  }
});

const rl = createInterface({
  input: createReadStream(srcPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

const BATCH = 5000;
let batch = [];

rl.on("line", (line) => {
  if (line.startsWith("#") || !line.trim()) return;
  batch.push(line);
  if (batch.length >= BATCH) {
    insertMany(batch);
    batch = [];
    process.stdout.write(`\r  Inserted ${count.toLocaleString()} entries...`);
  }
});

rl.on("close", () => {
  if (batch.length) insertMany(batch);

  // Switch back to WAL checkpoint and close
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();

  console.log(`\r  Done: ${count.toLocaleString()} entries inserted, ${skipped} skipped.`);
  console.log("  Database written to:", dbPath);
});
