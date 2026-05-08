/**
 * One-time seed: load CEDICT entries from data/cedict.txt into Supabase.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local
 * (Supabase dashboard → Settings → API → service_role key)
 *
 * Run: node scripts/seed-cedict-supabase.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

config({ path: ".env.local" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, "../data/cedict.txt");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

const LINE_RE = /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/\s*$/;
const BATCH = 500;

let batch = [];
let total = 0;

async function flush() {
  if (!batch.length) return;
  const { error } = await supabase.from("cedict").insert(batch);
  if (error) { console.error("Insert error:", error.message); process.exit(1); }
  total += batch.length;
  process.stdout.write(`\r  Inserted ${total.toLocaleString()} entries...`);
  batch = [];
}

console.log("Seeding CEDICT into Supabase...");

const rl = createInterface({
  input: createReadStream(srcPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  if (line.startsWith("#") || !line.trim()) continue;
  const m = LINE_RE.exec(line);
  if (!m) continue;
  const [, traditional, simplified, pinyin, english] = m;
  batch.push({ simplified, traditional, pinyin, english });
  if (batch.length >= BATCH) await flush();
}

await flush();
console.log(`\nDone: ${total.toLocaleString()} entries inserted.`);
