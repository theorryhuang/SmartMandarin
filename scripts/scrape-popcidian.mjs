/**
 * Scrape Popcidian.com slang dictionary with browser rendering
 * Uses Puppeteer to handle JavaScript-rendered content
 * 
 * Run: node scripts/scrape-popcidian.mjs [pages] [output]
 * Example: node scripts/scrape-popcidian.mjs 10 data/slang.json
 */

import fetch from "node-fetch";
import puppeteer from "puppeteer";
import { writeFileSync } from "fs";
import { dirname } from "path";

const DELAY_MS = 500; // shorter delay with browser
const BASE_URL = "https://www.popcidian.com";

// Parse command line arguments
const args = process.argv.slice(2);
const maxPages = parseInt(args[0]) || 1;
const outputFile = args[1] || "data/slang.json";

console.log(`🔍 Scraping Popcidian with browser rendering (max ${maxPages} pages)...`);
console.log(`💾 Output: ${outputFile}\n`);

const entries = [];
let pagesFetched = 0;
let entriesFetched = 0;

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scrapePage(page, pageNum) {
  try {
    const url = `${BASE_URL}/?page=${pageNum}`;
    console.log(`⏳ Fetching page ${pageNum}...`);
    
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Extract entry links
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href*="/entry/"]'))
        .map((el) => ({
          hanzi: el.textContent.trim(),
          url: el.href,
        }))
        .filter((e) => e.hanzi && e.hanzi.length < 50 && e.hanzi.length > 0)
        .slice(0, 15); // Limit to 15 per page
    });

    if (links.length === 0) {
      console.log(`⚠️  No entries found on page ${pageNum}`);
      return false;
    }

    console.log(`✅ Found ${links.length} entries on page ${pageNum}`);

    // Fetch details for each entry
    for (const link of links) {
      await sleep(DELAY_MS);

      try {
        await page.goto(link.url, { waitUntil: "networkidle2", timeout: 30000 });

        // Extract English meaning and category
        const data = await page.evaluate(() => {
          let meaning = "";
          const headers = document.querySelectorAll("h4");

          // Look for "English Explanation" or similar header
          for (let i = 0; i < headers.length; i++) {
            const headerText = headers[i].textContent.trim();
            if (headerText.includes("English") || headerText.includes("english")) {
              // Get all text between this h4 and the next h4
              let current = headers[i].nextElementSibling;
              let collected = [];

              while (current && current.tagName !== "H4") {
                const text = current.textContent.trim();
                // Skip empty lines and metadata
                if (
                  text &&
                  text.length > 5 &&
                  !text.startsWith("[") &&
                  !text.includes("placeholder")
                ) {
                  collected.push(text);
                }
                current = current.nextElementSibling;
              }

              meaning = collected
                .join(" ")
                .substring(0, 300);
              break;
            }
          }

          // Fallback to Chinese if English not found
          if (!meaning) {
            for (let i = 0; i < headers.length; i++) {
              if (headers[i].textContent.includes("中文解释")) {
                let current = headers[i].nextElementSibling;
                let collected = [];

                while (current && current.tagName !== "H4") {
                  const text = current.textContent.trim();
                  if (text && text.length > 5) {
                    collected.push(text);
                  }
                  current = current.nextElementSibling;
                }

                meaning = collected
                  .join(" ")
                  .substring(0, 300);
                break;
              }
            }
          }

          const categoryEl = document.querySelector('a[href*="/category/"]');
          const category = categoryEl
            ? categoryEl.textContent.trim()
            : "network slang";

          return { meaning, category };
        });

        if (data.meaning && data.meaning.length > 10) {
          entries.push({
            hanzi: link.hanzi,
            pinyin: "", // User can fill in manually
            meaning: data.meaning,
            category: data.category,
            source: "popcidian",
          });

          entriesFetched++;
          console.log(
            `  📝 ${link.hanzi}: ${data.meaning.substring(0, 35)}...`
          );
        } else {
          // Still add the entry even if no meaning found
          entries.push({
            hanzi: link.hanzi,
            pinyin: "",
            meaning: data.meaning || "",
            category: data.category,
            source: "popcidian",
          });

          entriesFetched++;
          console.log(`  ⚠️  ${link.hanzi}: (no meaning found)`);
        }
      } catch (e) {
        console.log(`  ❌ Error fetching ${link.hanzi}: ${e.message}`);
      }
    }

    pagesFetched++;
    return true;
  } catch (error) {
    console.error(`❌ Error on page ${pageNum}:`, error.message);
    return false;
  }
}

// Main
async function main() {
  let browser;
  try {
    console.log("🌐 Launching browser...\n");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30000);

    for (let i = 1; i <= maxPages; i++) {
      const success = await scrapePage(page, i);
      if (!success && i > 1) {
        console.log(`⏹️  Stopping\n`);
        break;
      }
    }

    await browser.close();

    // Save results
    writeFileSync(outputFile, JSON.stringify(entries, null, 2));

    console.log(
      `\n✅ Complete! Scraped ${entriesFetched} entries from ${pagesFetched} pages`
    );
    console.log(`💾 Saved to ${outputFile}`);
    console.log(`\n📊 Sample entries:`);
    console.log(JSON.stringify(entries.slice(0, 2), null, 2));
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main();
