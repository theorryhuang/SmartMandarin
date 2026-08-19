"use server";

import { createClient } from "@/lib/supabase/server";
import { submitReview } from "@/app/actions/vocabulary";
import { resolveGeminiKey } from "@/lib/gemini/resolveKey";
import { fetchGeminiInteractions } from "@/lib/gemini/interactions";
import { HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import type { Json } from "@/lib/supabase/database.types";
import type { FSRSRating, VocabularyMastery, DailyLearningBatch, DailyLearningWord, DailyState, DailyStreak, WordExample } from "@/lib/types";
import { computeStreak } from "@/lib/streak";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Today", as a plain date — the day boundary the whole daily-learning
 * program hangs off of (which batch is "yesterday's" to quiz, which is
 * "today's" to build/show).
 *
 * Takes the caller's local date (client components pass
 * `new Date().toLocaleDateString("en-CA")`) rather than computing it
 * server-side, because a fixed server clock — UTC or otherwise — resets
 * everyone's day at the same instant regardless of timezone: a UTC
 * boundary rolls over at 7-8pm the evening before for US Eastern, ~5:30am
 * for India, etc., which doesn't match anyone's actual "today". Falls back
 * to server UTC only when no client date is supplied (e.g. the home-page
 * badge count, which is server-rendered before any client date is known —
 * that's an approximate hint, not a decision point, and self-corrects the
 * moment the user opens /daily with their real local date).
 */
function todayStr(clientDate?: string): string {
  if (clientDate && DATE_RE.test(clientDate)) return clientDate;
  return new Date().toISOString().slice(0, 10);
}

async function getUserId(supabase: SupabaseClient): Promise<string> {
  return (await supabase.auth.getUser()).data.user?.id ?? "";
}

async function loadBatchWords(
  supabase: SupabaseClient,
  batchId: string,
  statusFilter?: DailyLearningWord["status"][]
): Promise<DailyLearningWord[]> {
  let query = supabase
    .from("daily_learning_words")
    .select("id, status, carried_over, word_id, vocabulary_mastery(*)")
    .eq("batch_id", batchId)
    .order("created_at", { ascending: true });
  if (statusFilter) query = query.in("status", statusFilter);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    dailyWordId: r.id as string,
    status: r.status as DailyLearningWord["status"],
    carriedOver: r.carried_over as boolean,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    word: r.vocabulary_mastery as unknown as VocabularyMastery,
  }));
}

/**
 * Every word_id that has ever appeared in a daily batch, plus the status of
 * its most recent attempt — used both to decide what's carried over
 * ('failed') and to make sure "new" word selection never re-offers a word
 * that's already mid-cycle (pending) or already passed.
 */
async function getAttemptHistory(
  supabase: SupabaseClient,
  userId: string
): Promise<{ everAttempted: Set<string>; latestStatusByWord: Map<string, DailyLearningWord["status"]> }> {
  const { data, error } = await supabase
    .from("daily_learning_words")
    .select("word_id, status, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const everAttempted = new Set<string>();
  const latestStatusByWord = new Map<string, DailyLearningWord["status"]>();
  for (const row of data ?? []) {
    everAttempted.add(row.word_id as string);
    if (!latestStatusByWord.has(row.word_id as string)) {
      latestStatusByWord.set(row.word_id as string, row.status as DailyLearningWord["status"]);
    }
  }
  return { everAttempted, latestStatusByWord };
}

/**
 * The easiest not-yet-learned words (lowest HSK level first, pinyin
 * alphabetical tiebreak), excluding anything ever attempted before.
 *
 * "Not-yet-learned" checks *both* daily_learned and FSRS stability — a word
 * can be sitting at high stability (i.e. mastered by the app's usual
 * definition, see HIGH_STABILITY_THRESHOLD) from being reviewed via
 * /review, the conversation practice, or the placement assessment, without
 * ever having gone through the daily-quiz flow that sets daily_learned.
 * Checking daily_learned alone was pulling already-mastered saved words
 * into daily batches.
 */
async function selectNewUnlearnedWords(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  excludeIds: Set<string>
): Promise<VocabularyMastery[]> {
  if (limit <= 0) return [];
  let query = supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .eq("is_slang", false)
    .eq("daily_learned", false)
    .lt("stability", HIGH_STABILITY_THRESHOLD)
    .order("hsk_level", { ascending: true, nullsFirst: false })
    .order("pinyin", { ascending: true })
    .limit(limit);
  if (excludeIds.size > 0) {
    query = query.not("id", "in", `(${[...excludeIds].join(",")})`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as VocabularyMastery[];
}

/**
 * Removes any *pending* daily-batch word that's since become (or already
 * was) mastered by the normal FSRS flow — e.g. reviewed to high stability
 * via /review after being pulled into a batch, or (before the stability
 * check above existed) pulled in despite already being mastered. Marks the
 * word daily_learned so it's never re-offered, then drops the row so it
 * doesn't linger in today's list or get quizzed tomorrow. Self-healing:
 * called at the top of getDailyState() so it cleans up on every visit.
 */
async function pruneAlreadyMasteredPendingWords(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("daily_learning_words")
    .select("id, word_id, batch_id, vocabulary_mastery(stability)")
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  const stale = (data ?? []).filter((row) => {
    const stability = (row.vocabulary_mastery as unknown as { stability: number } | null)?.stability ?? 0;
    return stability >= HIGH_STABILITY_THRESHOLD;
  });
  if (stale.length === 0) return;

  const staleWordIds = [...new Set(stale.map((r) => r.word_id as string))];
  const staleRowIds = stale.map((r) => r.id as string);

  await supabase.from("vocabulary_mastery").update({ daily_learned: true }).eq("user_id", userId).in("id", staleWordIds);
  await supabase.from("daily_learning_words").delete().eq("user_id", userId).in("id", staleRowIds);

  // Keep target_count honest so "N of target" doesn't overstate what's left.
  const removedPerBatch = new Map<string, number>();
  for (const row of stale) {
    const batchId = row.batch_id as string;
    removedPerBatch.set(batchId, (removedPerBatch.get(batchId) ?? 0) + 1);
  }
  for (const [batchId, removedCount] of removedPerBatch) {
    const { data: batch } = await supabase
      .from("daily_learning_batches")
      .select("target_count")
      .eq("id", batchId)
      .maybeSingle();
    if (batch) {
      await supabase
        .from("daily_learning_batches")
        .update({ target_count: Math.max(0, batch.target_count - removedCount) })
        .eq("id", batchId);
    }
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

export async function getDailyState(clientDate?: string): Promise<DailyState> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return { quizBatch: null, todayBatch: null };

  await pruneAlreadyMasteredPendingWords(supabase, userId);

  const today = todayStr(clientDate);

  // Oldest unresolved batch strictly before today (there should only ever be
  // at most one, since we never let a new batch get built while one is
  // still pending — but loop just in case a user skipped visiting for a
  // while before this feature enforced that).
  const { data: pastBatches, error: pastErr } = await supabase
    .from("daily_learning_batches")
    .select("id, batch_date, target_count")
    .eq("user_id", userId)
    .lt("batch_date", today)
    .order("batch_date", { ascending: true });
  if (pastErr) throw new Error(pastErr.message);

  let quizBatch: DailyLearningBatch | null = null;
  for (const b of pastBatches ?? []) {
    const words = await loadBatchWords(supabase, b.id, ["pending"]);
    if (words.length > 0) {
      quizBatch = { batchId: b.id, batchDate: b.batch_date, targetCount: b.target_count, words };
      break;
    }
  }

  const { data: todayRow, error: todayErr } = await supabase
    .from("daily_learning_batches")
    .select("id, batch_date, target_count")
    .eq("user_id", userId)
    .eq("batch_date", today)
    .maybeSingle();
  if (todayErr) throw new Error(todayErr.message);

  let todayBatch: DailyLearningBatch | null = null;
  if (todayRow) {
    const words = await loadBatchWords(supabase, todayRow.id);
    todayBatch = { batchId: todayRow.id, batchDate: todayRow.batch_date, targetCount: todayRow.target_count, words };
  }

  return { quizBatch, todayBatch };
}

// ─── Quiz resolution (previous unresolved day's words) ────────────────────────

export async function submitDailyQuizAnswer(
  dailyWordId: string,
  wordId: string,
  rating: FSRSRating
): Promise<{ passed: boolean; stability: number; difficulty: number; next_review: string }> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");

  // Good/Easy = passed and graduates into the normal FSRS review queue;
  // Again/Hard = failed and gets carried into today's batch.
  const passed = rating >= 3;

  let result: { stability: number; difficulty: number; next_review: string };
  try {
    result = await submitReview(wordId, rating, "review_session");
  } catch (err) {
    if (err instanceof Error && err.message === "WORD_DELETED") {
      result = { stability: 0, difficulty: 0, next_review: new Date().toISOString() };
    } else {
      throw err;
    }
  }

  const { error } = await supabase
    .from("daily_learning_words")
    .update({ status: passed ? "passed" : "failed", quizzed_at: new Date().toISOString() })
    .eq("id", dailyWordId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  if (passed) {
    await supabase
      .from("vocabulary_mastery")
      .update({ daily_learned: true })
      .eq("id", wordId)
      .eq("user_id", userId);
  }

  return { passed, ...result };
}

// ─── Building today's batch ────────────────────────────────────────────────────

/**
 * Builds (or returns the existing) batch for today: carried-over failed
 * words first, then the easiest not-yet-learned words (lowest HSK level,
 * pinyin alphabetical tiebreak) to fill the remainder up to `count`.
 * `count` is the total words for the day, not the count of *new* words —
 * carried-over words count against it.
 */
export async function startDailyBatch(count: number, clientDate?: string): Promise<DailyLearningBatch | null> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");
  if (!Number.isFinite(count) || count < 1) throw new Error("Invalid word count");

  const today = todayStr(clientDate);

  // Already built today — idempotent, just return it.
  const { data: existing, error: existingErr } = await supabase
    .from("daily_learning_batches")
    .select("id, batch_date, target_count")
    .eq("user_id", userId)
    .eq("batch_date", today)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);
  if (existing) {
    const words = await loadBatchWords(supabase, existing.id);
    return { batchId: existing.id, batchDate: existing.batch_date, targetCount: existing.target_count, words };
  }

  // Guard: an older batch must be fully quizzed first.
  const { data: pastBatches, error: pastErr } = await supabase
    .from("daily_learning_batches")
    .select("id")
    .eq("user_id", userId)
    .lt("batch_date", today);
  if (pastErr) throw new Error(pastErr.message);
  if (pastBatches && pastBatches.length > 0) {
    const ids = pastBatches.map((b) => b.id);
    const { count: pendingCount, error: pendingErr } = await supabase
      .from("daily_learning_words")
      .select("id", { count: "exact", head: true })
      .in("batch_id", ids)
      .eq("status", "pending");
    if (pendingErr) throw new Error(pendingErr.message);
    if ((pendingCount ?? 0) > 0) throw new Error("QUIZ_PENDING");
  }

  // Carried-over words: the word's *most recent* attempt (across all past
  // batches) is a 'failed' one, and it hasn't since been learned — checked
  // against current FSRS stability too, in case it got mastered via
  // /review in between (same reasoning as selectNewUnlearnedWords above).
  const { everAttempted, latestStatusByWord } = await getAttemptHistory(supabase, userId);
  const carriedIds = [...latestStatusByWord.entries()]
    .filter(([, status]) => status === "failed")
    .map(([id]) => id);

  let carriedWords: VocabularyMastery[] = [];
  if (carriedIds.length > 0) {
    const { data, error } = await supabase
      .from("vocabulary_mastery")
      .select("*")
      .eq("user_id", userId)
      .in("id", carriedIds)
      .lt("stability", HIGH_STABILITY_THRESHOLD);
    if (error) throw new Error(error.message);
    carriedWords = (data ?? []) as VocabularyMastery[];
  }

  // Computed from the *filtered* carried count, not carriedIds.length — a
  // carried word that turned out to already be mastered shouldn't shrink
  // how many new words get pulled in to fill the day's total.
  const remaining = Math.max(0, count - carriedWords.length);
  const newWords = await selectNewUnlearnedWords(supabase, userId, remaining, everAttempted);

  const totalWords = [...carriedWords, ...newWords];
  if (totalWords.length === 0) return null;

  const { data: batch, error: batchErr } = await supabase
    .from("daily_learning_batches")
    .insert({ user_id: userId, batch_date: today, target_count: count })
    .select("id, batch_date, target_count")
    .single();
  if (batchErr) throw new Error(batchErr.message);

  const rows = [
    ...carriedWords.map((w) => ({ batch_id: batch.id, user_id: userId, word_id: w.id, carried_over: true })),
    ...newWords.map((w) => ({ batch_id: batch.id, user_id: userId, word_id: w.id, carried_over: false })),
  ];
  const { error: insertErr } = await supabase.from("daily_learning_words").insert(rows);
  if (insertErr) throw new Error(insertErr.message);

  const words = await loadBatchWords(supabase, batch.id);
  return { batchId: batch.id, batchDate: batch.batch_date, targetCount: batch.target_count, words };
}

/**
 * Adds `count` more words to today's already-built batch, on top of
 * whatever target_count was originally chosen — for "actually, let me learn
 * a few more today." Only pulls words never attempted before, same
 * easiest-first ordering as the initial build. No-op (returns the batch
 * unchanged) if there's nothing left to add.
 */
export async function addToDailyBatch(count: number, clientDate?: string): Promise<DailyLearningBatch> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");
  if (!Number.isFinite(count) || count < 1) throw new Error("Invalid word count");

  const today = todayStr(clientDate);
  const { data: batchRow, error: batchErr } = await supabase
    .from("daily_learning_batches")
    .select("id, batch_date, target_count")
    .eq("user_id", userId)
    .eq("batch_date", today)
    .maybeSingle();
  if (batchErr) throw new Error(batchErr.message);
  if (!batchRow) throw new Error("NO_BATCH");

  const { everAttempted } = await getAttemptHistory(supabase, userId);
  const newWords = await selectNewUnlearnedWords(supabase, userId, count, everAttempted);

  let newTargetCount = batchRow.target_count;
  if (newWords.length > 0) {
    const rows = newWords.map((w) => ({ batch_id: batchRow.id, user_id: userId, word_id: w.id, carried_over: false }));
    const { error: insertErr } = await supabase.from("daily_learning_words").insert(rows);
    if (insertErr) throw new Error(insertErr.message);

    newTargetCount = batchRow.target_count + newWords.length;
    const { error: updateErr } = await supabase
      .from("daily_learning_batches")
      .update({ target_count: newTargetCount })
      .eq("id", batchRow.id);
    if (updateErr) throw new Error(updateErr.message);
  }

  const words = await loadBatchWords(supabase, batchRow.id);
  return { batchId: batchRow.id, batchDate: batchRow.batch_date, targetCount: newTargetCount, words };
}

// ─── Example sentences / use cases (cached per daily word, not saved to vocab) ─

const MAX_USE_CASES = 5;

/**
 * One Gemini call, JSON-parsed. Shared by the two request shapes below
 * (identify-use-cases, and re-request-one-use-case) so the fetch/abort/
 * parse boilerplate isn't duplicated between them.
 */
async function callGeminiJSON(apiKey: string, prompt: string): Promise<unknown> {
  // 30s, not grade-sentence's 20s — several sentences + pinyin +
  // translation each is a bigger ask than that route's single verdict.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetchGeminiInteractions(
      apiKey,
      { input: prompt, store: false, generation_config: { thinking_level: "minimal", max_output_tokens: 600 } },
      { signal: controller.signal }
    );
  } catch (err) {
    // A bare AbortError/DOMException would otherwise reach the client as
    // the raw "The operation was aborted" text — surface a message that
    // actually says what happened instead.
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Gemini timed out after 30s — try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const modelStep = data.steps?.find((s: { type: string }) => s.type === "model_output");
  const raw = modelStep?.content?.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim() ?? "";

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Model did not return valid JSON");
  }
}

/**
 * Returns one example sentence per distinct use case of a word in a daily
 * batch — not a fixed count. Most words have exactly one sense and get one
 * sentence; a genuinely polysemous word like 尽管 (concessive "despite" vs.
 * imperative "go ahead and…") gets one per sense, so the next day's quiz
 * (see DailyQuizCard) can test each of them instead of only ever probing
 * whichever single sense the model happened to pick.
 *
 * Generated with Gemini on first request and cached on the
 * daily_learning_words row so re-opening it later doesn't re-spend a call.
 * Deliberately not written back to vocabulary_mastery — this is scratch
 * reference material for the daily-learning flow, not part of the saved
 * vocab list.
 */
export async function getWordExamples(dailyWordId: string): Promise<WordExample[]> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");

  const { data: row, error } = await supabase
    .from("daily_learning_words")
    .select("example_sentences, vocabulary_mastery(hanzi, pinyin, meaning)")
    .eq("id", dailyWordId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("NOT_FOUND");

  if (row.example_sentences) {
    return row.example_sentences as unknown as WordExample[];
  }

  const word = row.vocabulary_mastery as unknown as { hanzi: string; pinyin: string; meaning: string };
  const { apiKey } = await resolveGeminiKey();

  // Gemini generating a sentence that quietly swaps in a synonym (e.g. 虽然
  // instead of the requested 尽管) is a real, observed failure mode — every
  // sentence below gets a plain substring check before being trusted, with
  // a per-use-case retry for anything that fails it.
  const wordDesc = `"${word.hanzi}"${word.pinyin ? ` (${word.pinyin})` : ""}${word.meaning ? `, meaning "${word.meaning}"` : ""}`;
  const HANZI_RULE = `Critical: the sentence must contain the exact characters "${word.hanzi}" verbatim. Never substitute a synonym or near-synonym (e.g. do not swap 尽管 for 虽然, or 立刻 for 马上) even if it reads more naturally — a sentence missing those exact characters is wrong.`;

  async function requestUseCases(): Promise<WordExample[]> {
    const prompt = `Identify the distinct common use cases (senses/usages) of the Mandarin word ${wordDesc} — most words genuinely have just one; only split out more (up to ${MAX_USE_CASES}) for words that are actually polysemous in everyday use (e.g. 尽管 as a concessive "despite/although" vs. its separate imperative "go ahead and — without hesitation" sense). Don't invent minor stylistic variants of the same sense as if they were distinct.

For each use case, give a short label (a few words, e.g. "despite / although (concessive)") and one short, natural example sentence using it. Keep sentences simple enough for a learner (roughly HSK 1-4 vocabulary aside from the target word itself), and vary context across use cases so they're not near-duplicates.

${HANZI_RULE}

Respond with ONLY valid JSON (no markdown, no extra text): an array of one object per use case:
[
  { "useCase": "...", "sentence": "...", "pinyin": "...", "translation": "..." }
]`;
    const parsed = await callGeminiJSON(apiKey, prompt);
    return Array.isArray(parsed) ? (parsed as WordExample[]).slice(0, MAX_USE_CASES) : [];
  }

  async function requestForUseCase(useCase: string): Promise<WordExample | null> {
    const prompt = `Give one short, natural Mandarin example sentence using ${wordDesc}, specifically demonstrating this use case/sense: "${useCase}". Keep it simple enough for a learner (roughly HSK 1-4 vocabulary aside from the target word itself).

${HANZI_RULE}

Respond with ONLY valid JSON (no markdown, no extra text): a single object:
{ "sentence": "...", "pinyin": "...", "translation": "..." }`;
    const parsed = await callGeminiJSON(apiKey, prompt);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const ex = parsed as Omit<WordExample, "useCase">;
    return ex.sentence ? { useCase, ...ex } : null;
  }

  const initial = await requestUseCases();
  const valid: WordExample[] = [];
  const needsRetry: string[] = [];
  for (const ex of initial) {
    if (ex.useCase && ex.sentence?.includes(word.hanzi)) {
      valid.push(ex);
    } else if (ex.useCase) {
      needsRetry.push(ex.useCase);
    }
  }
  // One retry pass per use case that failed the hanzi check the first
  // time — bounded (never more calls than the model's own use-case count),
  // rather than an open-ended loop.
  for (const useCase of needsRetry) {
    const retried = await requestForUseCase(useCase);
    if (retried?.sentence.includes(word.hanzi)) valid.push(retried);
  }

  if (valid.length === 0) {
    throw new Error("Model couldn't produce a sentence actually using this word — try again.");
  }
  const examples = valid;

  await supabase
    .from("daily_learning_words")
    .update({ example_sentences: examples as unknown as Json })
    .eq("id", dailyWordId)
    .eq("user_id", userId);

  return examples;
}

// ─── Manual re-queue ────────────────────────────────────────────────────────────

/**
 * Manually clears daily_learned on a word so it can be picked up by the
 * daily program again — the escape hatch for "I passed this a while ago
 * but I've genuinely forgotten it since" without waiting to fail it in
 * /review first (see the auto-reset on rating===1 in submitReview).
 */
export async function resetDailyLearned(wordId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) throw new Error("Not signed in");

  const { error } = await supabase
    .from("vocabulary_mastery")
    .update({ daily_learned: false })
    .eq("id", wordId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ─── Streak ─────────────────────────────────────────────────────────────────────

/**
 * A "streak day" is any calendar day a batch got built — that's the one
 * action guaranteed to happen every day the program is used (quizzing only
 * happens from the *second* day onward). Today doesn't have to be built yet
 * for the streak to still be alive: it only breaks once a full day passes
 * with no batch at all, so walking back starts from today if it's already
 * built, otherwise from yesterday.
 */
export async function getDailyStreak(clientDate?: string): Promise<DailyStreak> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return { current: 0, longest: 0, activeDates: [] };

  const { data, error } = await supabase
    .from("daily_learning_batches")
    .select("batch_date")
    .eq("user_id", userId)
    .order("batch_date", { ascending: true });
  if (error) throw new Error(error.message);

  const activeDates = (data ?? []).map((r) => r.batch_date as string);
  return computeStreak(activeDates, todayStr(clientDate));
}

// ─── Home page badge ────────────────────────────────────────────────────────────

export async function getDailyQuizPendingCount(): Promise<number> {
  const supabase = await createClient();
  const userId = await getUserId(supabase);
  if (!userId) return 0;

  // Server-rendered on the home page, before any client-local date is
  // known — uses the UTC fallback in todayStr(). Only an approximate
  // badge/hint; the actual quiz/build flow on /daily always gets the
  // caller's real local date and is where correctness matters.
  const today = todayStr();
  const { data: pastBatches } = await supabase
    .from("daily_learning_batches")
    .select("id")
    .eq("user_id", userId)
    .lt("batch_date", today);
  const ids = (pastBatches ?? []).map((b) => b.id);
  if (ids.length === 0) return 0;

  const { count } = await supabase
    .from("daily_learning_words")
    .select("id", { count: "exact", head: true })
    .in("batch_id", ids)
    .eq("status", "pending");
  return count ?? 0;
}
