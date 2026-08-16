"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { calculateNextReview, HIGH_STABILITY_THRESHOLD } from "@/lib/fsrs";
import type { FSRSRating, VocabularyMastery } from "@/lib/types";

// ─── Fetch ────────────────────────────────────────────────────────────────────

export async function getDueWords(limit = 20): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_due_words", {
    p_user_id: (await supabase.auth.getUser()).data.user?.id ?? "",
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as VocabularyMastery[];
}

export async function getHSKLevelStats() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_hsk_level_stats", {
    p_user_id: (await supabase.auth.getUser()).data.user?.id ?? "",
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ─── Review ───────────────────────────────────────────────────────────────────

export async function submitReview(
  wordId: string,
  rating: FSRSRating,
  source: "conversation" | "reader" | "review_session" = "review_session"
): Promise<{ stability: number; difficulty: number; next_review: string }> {
  const supabase = await createClient();

  // Fetch current card state (maybeSingle returns null instead of error when row missing)
  const { data: card, error: fetchErr } = await supabase
    .from("vocabulary_mastery")
    .select("stability, difficulty, last_reviewed")
    .eq("id", wordId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!card) throw new Error("WORD_DELETED");

  const lastReview = card.last_reviewed ? new Date(card.last_reviewed) : null;
  const result = calculateNextReview(
    card.stability,
    card.difficulty,
    lastReview,
    rating
  );

  // Write updated FSRS state
  const { error: updateErr } = await supabase
    .from("vocabulary_mastery")
    .update({
      stability: result.stability,
      difficulty: result.difficulty,
      last_reviewed: new Date().toISOString(),
      next_review: result.next_review.toISOString(),
      flagged_for_immediate_use: false, // clear urgent flag after review
      review_count: card.stability === 0 ? 1 : undefined, // handled by DB increment below
    })
    .eq("id", wordId);
  if (updateErr) throw new Error(updateErr.message);

  // Increment review_count atomically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)("increment_review_count", { word_id: wordId });

  // Append to audit log
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  await supabase.from("review_log").insert({
    user_id: userId,
    word_id: wordId,
    rating,
    stability_before: card.stability,
    stability_after: result.stability,
    difficulty_before: card.difficulty,
    difficulty_after: result.difficulty,
    retrievability: result.retrievability,
    source,
  });

  return {
    stability: result.stability,
    difficulty: result.difficulty,
    next_review: result.next_review.toISOString(),
  };
}

// ─── Mistake logging (tapped word in transcript / reader) ─────────────────────

/**
 * Flag a word for immediate re-injection into the next AI turn.
 * If the word isn't tracked yet, upserts it first with default FSRS values.
 */
export async function logMistake(
  wordIdOrHanzi: string,
  meta?: { pinyin?: string; meaning?: string; hsk_level?: number }
): Promise<void> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  // Check if this is a UUID (existing word) or hanzi string (new word)
  const isUUID = /^[0-9a-f-]{36}$/i.test(wordIdOrHanzi);

  if (isUUID) {
    await supabase
      .from("vocabulary_mastery")
      .update({ flagged_for_immediate_use: true })
      .eq("id", wordIdOrHanzi)
      .eq("user_id", userId);
  } else {
    // Upsert by hanzi — creates the word if unseen, otherwise just flags it
    await supabase
      .from("vocabulary_mastery")
      .upsert(
        {
          user_id: userId,
          hanzi: wordIdOrHanzi,
          pinyin: meta?.pinyin ?? "",
          meaning: meta?.meaning ?? "",
          hsk_level: meta?.hsk_level ?? null,
          flagged_for_immediate_use: true,
        },
        { onConflict: "user_id,hanzi,pinyin,meaning", ignoreDuplicates: false }
      );
  }
}

// ─── Conversation context ──────────────────────────────────────────────────────

/**
 * Returns the user's derived HSK level and their persistent unknown-word bank
 * (words flagged in past sessions or with very low FSRS stability after reviews).
 * Called by ConversationClient before opening a Gemini Live session.
 */
export async function getConversationContext(): Promise<{
  hskLevel: number;
  unknownWords: { hanzi: string; pinyin: string; meaning: string }[];
}> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  // Derive current HSK level from per-level stats.
  // "Current level" = highest level where the user has ≥5 words tracked.
  const { data: stats } = await supabase.rpc("get_hsk_level_stats", {
    p_user_id: userId,
  });

  let hskLevel = 1;
  if (stats && stats.length > 0) {
    const activeLevels = (stats as { level: number; total: number }[]).filter(
      (s) => s.total >= 1
    );
    if (activeLevels.length > 0) {
      hskLevel = Math.max(...activeLevels.map((s) => s.level));
    }
  }

  // Fetch persistent unknown words: explicitly flagged by user in past sessions,
  // plus low-stability words they've reviewed but keep struggling with.
  const { data: flagged } = await supabase
    .from("vocabulary_mastery")
    .select("hanzi, pinyin, meaning")
    .eq("user_id", userId)
    .eq("flagged_for_immediate_use", true)
    .order("updated_at", { ascending: false })
    .limit(15);

  const { data: weak } = await supabase
    .from("vocabulary_mastery")
    .select("hanzi, pinyin, meaning")
    .eq("user_id", userId)
    .eq("flagged_for_immediate_use", false)
    .gt("review_count", 0)
    .lt("stability", 7)
    .order("stability", { ascending: true })
    .limit(10);

  // Merge, dedup by hanzi
  const seen = new Set<string>();
  const unknownWords: { hanzi: string; pinyin: string; meaning: string }[] = [];
  for (const w of [...(flagged ?? []), ...(weak ?? [])]) {
    if (!seen.has(w.hanzi)) {
      seen.add(w.hanzi);
      unknownWords.push({ hanzi: w.hanzi, pinyin: w.pinyin, meaning: w.meaning });
    }
  }

  return { hskLevel, unknownWords };
}

// ─── Assessment ───────────────────────────────────────────────────────────────

export interface AssessmentWord {
  hanzi: string;
  pinyin: string;
  meaning: string;
  hsk_level: number;
  knew: boolean;
}

/**
 * Persists placement-test results:
 * - Known words → upserted with high stability so they won't crowd the review queue.
 * - Unknown words → upserted with stability 0 so they surface for review soon.
 *
 * Also sets the sm_assessed cookie so the home page won't redirect again.
 */
export async function saveAssessmentResults(words: AssessmentWord[]): Promise<void> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  if (userId && words.length > 0) {
    const now = new Date().toISOString();
    // Known words: treat as if reviewed once with "Easy" — far next_review date
    const farFuture = new Date(Date.now() + HIGH_STABILITY_THRESHOLD * 2 * 86_400_000).toISOString();

    const rows = words.map((w) => ({
      user_id: userId,
      hanzi: w.hanzi,
      pinyin: w.pinyin,
      meaning: w.meaning,
      hsk_level: w.hsk_level,
      stability: w.knew ? HIGH_STABILITY_THRESHOLD * 2 : 0,
      difficulty: w.knew ? 4 : 7,           // easy known / harder unknown baseline
      review_count: w.knew ? 1 : 0,
      last_reviewed: w.knew ? now : null,
      next_review: w.knew ? farFuture : now, // unknown words are due immediately
      flagged_for_immediate_use: false,
    }));

    await supabase
      .from("vocabulary_mastery")
      .upsert(rows, { onConflict: "user_id,hanzi,pinyin,meaning", ignoreDuplicates: true });
  }

  await markAssessmentComplete();
}

/**
 * Sets the sm_assessed cookie so the user is never redirected to assessment again.
 * Call this even when the user skips the assessment.
 */
export async function markAssessmentComplete(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("sm_assessed", "1", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365 * 10, // 10 years
    httpOnly: true,
    sameSite: "lax",
  });
}

export async function getAvailableHSKLevels(): Promise<number[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  const { data } = await supabase
    .from("vocabulary_mastery")
    .select("hsk_level")
    .eq("user_id", userId)
    .not("hsk_level", "is", null);
  const levels = [...new Set((data ?? []).map((r) => Math.floor(r.hsk_level as number)))].sort((a, b) => a - b);
  return levels;
}

export async function getWordsByHSK(hskLevel: number, limit = 200): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  const { data } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .gte("hsk_level", hskLevel)
    .lt("hsk_level", hskLevel + 1)
    .order("stability", { ascending: true })
    .limit(limit);
  return (data ?? []) as VocabularyMastery[];
}

// For 7+ (covers 7, 8, 9) pass no maxLevel
export async function getNoHSKWords(limit = 200): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  const { data } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .is("hsk_level", null)
    .order("stability", { ascending: true })
    .limit(limit);
  return (data ?? []) as VocabularyMastery[];
}

export async function getWordsByHSKRange(minLevel: number, maxLevel?: number, limit = 200): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  let query = supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .gte("hsk_level", minLevel);
  if (maxLevel !== undefined) query = query.lt("hsk_level", maxLevel);
  const { data } = await query.order("stability", { ascending: true }).limit(limit);
  return (data ?? []) as VocabularyMastery[];
}

export async function getWordsByMastery(limit = 200): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  const { data } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .order("stability", { ascending: true })
    .limit(limit);
  return (data ?? []) as VocabularyMastery[];
}

export async function getUnreviewedWords(limit = 200, minHSK?: number, maxHSK?: number, noHSK?: boolean): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  let query = supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .eq("review_count", 0);
  if (noHSK) {
    query = query.is("hsk_level", null);
  } else {
    if (minHSK !== undefined) query = query.gte("hsk_level", minHSK);
    if (maxHSK !== undefined) query = query.lt("hsk_level", maxHSK);
  }
  const { data } = await query.limit(limit);
  return (data ?? []) as VocabularyMastery[];
}

/**
 * `pinyin`/`meaning` disambiguate which sense's row to target when a hanzi
 * has more than one saved sense — required by callers that only have the
 * hanzi string, not the row id, to avoid hitting every sense. Pinyin alone
 * isn't always enough (CEDICT sometimes lists distinct senses under the same
 * reading, e.g. 打 dǎ "to hit" vs "dozen"); pass `meaning` too when known.
 * Omitting both falls back to matching by hanzi alone (affects every sense).
 */
export async function deleteWord(wordIdOrHanzi: string, pinyin?: string, meaning?: string): Promise<void> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  const isUUID = /^[0-9a-f-]{36}$/i.test(wordIdOrHanzi);
  if (isUUID) {
    await supabase.from("vocabulary_mastery").delete().eq("id", wordIdOrHanzi).eq("user_id", userId);
  } else {
    let query = supabase.from("vocabulary_mastery").delete().eq("hanzi", wordIdOrHanzi).eq("user_id", userId);
    if (pinyin) query = query.eq("pinyin", pinyin);
    if (meaning) query = query.eq("meaning", meaning);
    await query;
  }
}

export async function removeFromReviewQueue(wordIdOrHanzi: string, pinyin?: string, meaning?: string): Promise<void> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  const isUUID = /^[0-9a-f-]{36}$/i.test(wordIdOrHanzi);
  if (isUUID) {
    await supabase
      .from("vocabulary_mastery")
      .update({ flagged_for_immediate_use: false })
      .eq("id", wordIdOrHanzi)
      .eq("user_id", userId);
  } else {
    let query = supabase
      .from("vocabulary_mastery")
      .update({ flagged_for_immediate_use: false })
      .eq("hanzi", wordIdOrHanzi)
      .eq("user_id", userId);
    if (pinyin) query = query.eq("pinyin", pinyin);
    if (meaning) query = query.eq("meaning", meaning);
    await query;
  }
}

export async function getDueWordsByLastRating(
  ratings: number[],
  isSlang = false,
  limit = 100,
  minHSK?: number,
  maxHSK?: number,
  noHSK?: boolean,
): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  // Fetch recent review_log entries to find last rating per word
  const { data: logRows, error: logErr } = await supabase
    .from("review_log")
    .select("word_id, rating, reviewed_at")
    .eq("user_id", userId)
    .order("reviewed_at", { ascending: false })
    .limit(10000);
  if (logErr) throw new Error(logErr.message);

  // Keep only the most recent entry per word
  const lastRatingMap = new Map<string, number>();
  for (const row of logRows ?? []) {
    if (!lastRatingMap.has(row.word_id)) {
      lastRatingMap.set(row.word_id, row.rating);
    }
  }

  const matchingIds = Array.from(lastRatingMap.entries())
    .filter(([, r]) => ratings.includes(r))
    .map(([id]) => id);

  if (matchingIds.length === 0) return [];

  let query = supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .eq("is_slang", isSlang)
    .in("id", matchingIds);
  if (noHSK) {
    query = query.is("hsk_level", null);
  } else {
    if (minHSK !== undefined) query = query.gte("hsk_level", minHSK);
    if (maxHSK !== undefined) query = query.lt("hsk_level", maxHSK);
  }
  const { data, error } = await query.order("next_review", { ascending: true, nullsFirst: true }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as VocabularyMastery[];
}

export async function getAllWords(limit = 100): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  const { data, error } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .eq("is_slang", false)
    .order("next_review", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as VocabularyMastery[];
}

export async function getDueSlangWords(limit = 20): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .eq("is_slang", true)
    .or(`flagged_for_immediate_use.eq.true,next_review.is.null,next_review.lte.${now}`)
    .order("flagged_for_immediate_use", { ascending: false })
    .order("next_review", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as VocabularyMastery[];
}

export async function getAllSlangWords(limit = 200): Promise<VocabularyMastery[]> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  const { data, error } = await supabase
    .from("vocabulary_mastery")
    .select("*")
    .eq("user_id", userId)
    .eq("is_slang", true)
    .order("next_review", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as VocabularyMastery[];
}

// ─── Add / seed words ─────────────────────────────────────────────────────────

export async function addWord(word: {
  hanzi: string;
  pinyin: string;
  meaning: string;
  hsk_level: number;
  is_slang?: boolean;
}): Promise<void> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  const { error } = await supabase.from("vocabulary_mastery").upsert(
    {
      user_id: userId,
      hanzi: word.hanzi,
      pinyin: word.pinyin,
      meaning: word.meaning,
      hsk_level: word.hsk_level,
      is_slang: word.is_slang ?? false,
    },
    { onConflict: "user_id,hanzi,pinyin,meaning", ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);
}

export async function addWords(
  words: Array<{
    hanzi: string;
    pinyin: string;
    meaning: string;
    hsk_level: number;
    is_slang?: boolean;
  }>
): Promise<void> {
  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";

  const rows = words.map((w) => ({
    user_id: userId,
    hanzi: w.hanzi,
    pinyin: w.pinyin,
    meaning: w.meaning,
    hsk_level: w.hsk_level,
    is_slang: w.is_slang ?? false,
  }));

  const { error } = await supabase
    .from("vocabulary_mastery")
    .upsert(rows, { onConflict: "user_id,hanzi,pinyin,meaning", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
