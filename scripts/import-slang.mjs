/**
 * Import scraped slang data into Supabase slang_bank table
 * 
 * Run: node scripts/import-slang.mjs data/slang.json
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const inputFile = process.argv[2] || "data/slang.json";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

console.log(`📖 Reading slang data from ${inputFile}...`);
const data = JSON.parse(readFileSync(inputFile, "utf-8"));

console.log(`📊 Found ${data.length} slang entries\n`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function importSlang() {
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of data) {
    try {
      // Check if already exists
      const { data: existing } = await supabase
        .from("slang_bank")
        .select("id")
        .eq("hanzi", entry.hanzi)
        .single();

      if (existing) {
        skipped++;
        console.log(`⏭️  Skipping ${entry.hanzi} (already exists)`);
        continue;
      }

      // Insert entry
      const { error } = await supabase.from("slang_bank").insert({
        hanzi: entry.hanzi,
        pinyin: entry.pinyin || null,
        meaning: entry.meaning,
        category: entry.category || "network slang",
        example: entry.example || null,
        source: entry.source || "popcidian",
      });

      if (error) {
        console.log(`❌ Failed to insert ${entry.hanzi}: ${error.message}`);
        errors++;
      } else {
        imported++;
        console.log(
          `✅ ${entry.hanzi}: ${entry.meaning?.substring(0, 40) || "..."}`
        );
      }
    } catch (e) {
      console.log(`❌ Error processing ${entry.hanzi}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n📈 Import complete!`);
  console.log(`  ✅ Imported: ${imported}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log(`  ❌ Errors: ${errors}`);
}

importSlang().catch(console.error);
