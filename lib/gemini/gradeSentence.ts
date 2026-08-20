import { fetchGeminiInteractions } from "@/lib/gemini/interactions";

export interface GradeSentenceParams {
  hanzi: string;
  pinyin?: string;
  meaning?: string;
  sentence: string;
  /**
   * Narrows grading to one specific sense of a polysemous word (see
   * getWordExamples() in app/actions/dailyLearning.ts) — a sentence correct
   * in some *other* sense of the word should fail, not pass on a
   * technicality.
   */
  useCase?: string;
}

export interface GradeSentenceResult {
  valid: boolean;
  natural: boolean;
  feedback: string;
  corrected: string | null;
}

/**
 * Single source of truth for "is this practice sentence correct" — used by
 * both /api/grade-sentence (grading the student's own sentence) and
 * getWordExamples' self-check (grading the *model's own* generated example
 * before ever showing it to a student, see the comment there for why).
 * Sharing this prompt means both call sites agree on what "correct" means
 * for a given word/sense instead of two independently-tuned prompts quietly
 * drifting apart.
 */
export async function gradeSentence(apiKey: string, params: GradeSentenceParams): Promise<GradeSentenceResult> {
  const { hanzi, pinyin, meaning, sentence, useCase } = params;

  const senseClause = useCase
    ? ` The student is specifically being tested on this use case/sense of the word: "${useCase}" — the sentence must demonstrate *that* sense, not just any correct use of "${hanzi}"; a grammatically fine sentence that uses a different sense of the word should fail uses_word.`
    : "";

  const prompt = `You are a Mandarin teacher grading a student's practice sentence. The student is specifically practicing the word "${hanzi}"${pinyin ? ` (${pinyin})` : ""}${meaning ? `, meaning "${meaning}"` : ""} — the whole point of the exercise is for them to learn to use THIS word correctly.${senseClause}

The student wrote this sentence: "${sentence}"

Evaluate it:
- grammatical: is the sentence grammatically correct Mandarin?
- uses_word: does it actually use "${hanzi}" with its correct meaning/usage (not just present as characters, but semantically correct)? Set this false if the context the student built doesn't actually fit how "${hanzi}" is used.
- natural: would a native speaker phrase it this way?

For "feedback" on a uses_word or natural failure: teach the student how "${hanzi}" itself is correctly used — what it means and the kind of context/sense it belongs in — so they learn to use THIS word. Do not phrase feedback as "use word Y instead" or otherwise center a different word as the fix; naming a genuinely confusable word in passing to clarify the distinction is fine, but the takeaway must be how to wield "${hanzi}" correctly, not an instruction to swap it out.

For "corrected", rewrite the student's sentence so it is natural AND still uses "${hanzi}"${useCase ? ` in the "${useCase}" sense` : ""} — keep their original idea/topic, just fix the grammar or word choice around it so "${hanzi}" itself is used correctly. Never substitute "${hanzi}" for a different word, even if that other word would fit better; the corrected sentence's job is to demonstrate "${hanzi}" used correctly, not to produce the most natural sentence possible. Set "corrected" to null only if the student's sentence already does this well.

Critical: "corrected" and "feedback" must agree. If "feedback" names a specific problem (wrong word, awkward phrasing, wrong structure), "corrected" MUST actually fix that exact problem — not just tidy up unrelated punctuation/spacing while leaving the named issue untouched. If natural is false or valid is false, "corrected" must differ from the original in the way "feedback" describes; it cannot be null or a no-op change in that case.

Respond with ONLY valid JSON (no markdown, no extra text):
{
  "valid": true|false,
  "natural": true|false,
  "feedback": "one short encouraging sentence in English explaining what's right or wrong",
  "corrected": "a natural version of the sentence that still uses \"${hanzi}\" correctly, or null if no changes needed"
}`;

  // thinking_level pinned to "minimal": without it gemini-3.6-flash uses
  // dynamic thinking and can burn 60+s of hidden reasoning on subjective
  // calls (e.g. "is this natural?"). This is a short classification task,
  // not something that needs deep deliberation.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetchGeminiInteractions(
      apiKey,
      { input: prompt, store: false, generation_config: { thinking_level: "minimal", max_output_tokens: 300 } },
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail: string = body;
    try {
      detail = JSON.parse(body)?.error?.message ?? body;
    } catch {}
    const err = new Error(`Gemini API error (${res.status}): ${detail}`) as Error & { status?: number; retryAfterSeconds?: number | null };
    err.status = res.status;
    if (res.status === 429) {
      const retryMatch = body.match(/retry in ([\d.]+)s/i);
      err.retryAfterSeconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : null;
    }
    throw err;
  }

  const data = await res.json();
  const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
  const raw = modelStep?.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim() ?? "";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Model did not return valid JSON: ${raw}`);
  }

  return {
    valid: Boolean(parsed.valid),
    natural: Boolean(parsed.natural),
    feedback: parsed.feedback ?? "",
    corrected: parsed.corrected ?? null,
  };
}
