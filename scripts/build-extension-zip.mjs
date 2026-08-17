#!/usr/bin/env node
// Zips browser-extension/ into public/smartmandarin-extension.zip so the
// settings page can offer a direct download instead of sending users to
// GitHub. Not wired into the Vercel build — `zip` isn't guaranteed present
// there — so re-run this manually (`npm run build:extension-zip`) whenever
// browser-extension/ changes and commit the resulting zip.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(root, "browser-extension");
const outFile = path.join(root, "public", "smartmandarin-extension.zip");

if (!existsSync(srcDir)) {
  console.error(`browser-extension/ not found at ${srcDir}`);
  process.exit(1);
}

if (existsSync(outFile)) rmSync(outFile);

try {
  execFileSync("zip", ["-r", "-X", outFile, ".", "-x", ".*", "-x", "__MACOSX"], {
    cwd: srcDir,
    stdio: "inherit",
  });
} catch (e) {
  console.error("Zipping failed — is the `zip` CLI installed?", e.message);
  process.exit(1);
}

console.log(`Wrote ${path.relative(root, outFile)}`);
