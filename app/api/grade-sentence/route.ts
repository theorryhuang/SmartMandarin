import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { resolveGeminiKey } from "@/lib/gemini/resolveKey";
import { gradeSentence } from "@/lib/gemini/gradeSentence";

export async function POST(req: NextRequest) {
  let apiKey: string;
  try {
    ({ apiKey } = await resolveGeminiKey());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No Gemini key available" }, { status: 500 });
  }

  const { hanzi, pinyin, meaning, sentence, useCase } = await req.json().catch(() => ({}));
  if (!hanzi || !sentence || !String(sentence).trim()) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const result = await gradeSentence(apiKey, { hanzi, pinyin, meaning, sentence, useCase });
    console.log(`[grade-sentence] Gemini responded after ${Date.now() - startedAt}ms`);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.error(`[grade-sentence] AbortError — no response from Gemini within 20s (started ${Date.now() - startedAt}ms ago)`);
      Sentry.captureMessage("[grade-sentence] Gemini timed out after 20s", "warning");
      return NextResponse.json({ error: "Gemini timed out after 20s" }, { status: 504 });
    }
    const status = (e as { status?: number })?.status;
    if (status === 429) {
      const retryAfterSeconds = (e as { retryAfterSeconds?: number | null })?.retryAfterSeconds ?? null;
      console.error(`[grade-sentence] Gemini API error 429 after ${Date.now() - startedAt}ms`);
      return NextResponse.json({ error: "Rate limited", retry_after_seconds: retryAfterSeconds }, { status: 429 });
    }
    console.error(`[grade-sentence] error after ${Date.now() - startedAt}ms`, e);
    if (status) {
      Sentry.captureMessage(`[grade-sentence] Gemini API error ${status}: ${e instanceof Error ? e.message.slice(0, 500) : String(e)}`, "error");
    } else {
      Sentry.captureException(e);
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
