import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { resolveGeminiKey } from "@/lib/gemini/resolveKey";
import { fetchGeminiInteractions } from "@/lib/gemini/interactions";

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

  // useCase narrows grading to one specific sense of a polysemous word
  // (see getWordExamples() in app/actions/dailyLearning.ts) — a word like
  // 尽管 has a "despite/although" sense and a separate imperative "go ahead
  // and…" sense, and a sentence correct in one sense but not the one being
  // tested should fail this check, not pass on a technicality.
  const senseClause = useCase
    ? ` The student is specifically being tested on this use case/sense of the word: "${useCase}" — the sentence must demonstrate *that* sense, not just any correct use of "${hanzi}"; a grammatically fine sentence that uses a different sense of the word should fail uses_word.`
    : "";

  const prompt = `You are a Mandarin teacher grading a student's practice sentence. The student is specifically practicing the word "${hanzi}"${pinyin ? ` (${pinyin})` : ""}${meaning ? `, meaning "${meaning}"` : ""} — the whole point of the exercise is for them to learn to use THIS word correctly.${senseClause}

The student wrote this sentence: "${sentence}"

Evaluate it:
- grammatical: is the sentence grammatically correct Mandarin?
- uses_word: does it actually use "${hanzi}" with its correct meaning/usage (not just present as characters, but semantically correct)? If a different, similar word would actually be the better/correct choice here, that means the student misused "${hanzi}" — set this false and explain the mix-up in feedback (e.g. confusing it with that other word).
- natural: would a native speaker phrase it this way?

For "corrected", rewrite the student's sentence so it is natural AND still uses "${hanzi}"${useCase ? ` in the "${useCase}" sense` : ""} — keep their original idea/topic, just fix the grammar or word choice around it so "${hanzi}" itself is used correctly. Never substitute "${hanzi}" for a different word, even if that other word would fit better; the corrected sentence's job is to demonstrate "${hanzi}" used correctly, not to produce the most natural sentence possible. Set "corrected" to null only if the student's sentence already does this well.

Critical: "corrected" and "feedback" must agree. If "feedback" names a specific problem (wrong word, awkward phrasing, wrong structure), "corrected" MUST actually fix that exact problem — not just tidy up unrelated punctuation/spacing while leaving the named issue untouched. If natural is false or valid is false, "corrected" must differ from the original in the way "feedback" describes; it cannot be null or a no-op change in that case.

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "valid": true|false,
  "natural": true|false,
  "feedback": "one short encouraging sentence in English explaining what's right or wrong",
  "corrected": "a natural version of the sentence that still uses \"${hanzi}\" correctly, or null if no changes needed"
}`;

  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    // thinking_level pinned to "minimal": without it gemini-3.6-flash uses
    // dynamic thinking and can burn 60+s of hidden reasoning on subjective
    // calls (e.g. "is this natural?"). This is a short classification task,
    // not something that needs deep deliberation.
    const res = await fetchGeminiInteractions(
      apiKey,
      { input: prompt, store: false, generation_config: { thinking_level: "minimal", max_output_tokens: 300 } },
      { signal: controller.signal }
    ).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[grade-sentence] Gemini API error ${res.status} after ${Date.now() - startedAt}ms: ${body}`);
      if (res.status === 429) {
        const retryMatch = body.match(/retry in ([\d.]+)s/i);
        return NextResponse.json(
          { error: "Rate limited", retry_after_seconds: retryMatch ? Math.ceil(Number(retryMatch[1])) : null },
          { status: 429 }
        );
      }
      let detail = body;
      try {
        detail = JSON.parse(body)?.error?.message ?? body;
      } catch {}
      Sentry.captureMessage(`[grade-sentence] Gemini API error ${res.status}: ${String(detail).slice(0, 500)}`, "error");
      return NextResponse.json({ error: `Gemini API error (${res.status}): ${detail}` }, { status: 500 });
    }

    console.log(`[grade-sentence] Gemini responded 200 after ${Date.now() - startedAt}ms`);
    const data = await res.json();
    const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
    const raw = modelStep?.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim() ?? "";

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error(`[grade-sentence] Failed to parse model output as JSON: ${raw}`);
      throw new Error("Model did not return valid JSON");
    }
    return NextResponse.json({
      valid: Boolean(parsed.valid),
      natural: Boolean(parsed.natural),
      feedback: parsed.feedback ?? "",
      corrected: parsed.corrected ?? null,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.error(`[grade-sentence] AbortError — no response from Gemini within 20s (started ${Date.now() - startedAt}ms ago)`);
      Sentry.captureMessage("[grade-sentence] Gemini timed out after 20s", "warning");
      return NextResponse.json({ error: "Gemini timed out after 20s" }, { status: 504 });
    }
    console.error("[grade-sentence]", e);
    Sentry.captureException(e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
