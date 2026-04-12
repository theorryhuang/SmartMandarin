"use server";

import { createClient } from "@/lib/supabase/server";
import { calculateNextReview } from "@/lib/fsrs";
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

  // Fetch current card state
  const { data: card, error: fetchErr } = await supabase
    .from("vocabulary_mastery")
    .select("stability, difficulty, last_reviewed")
    .eq("id", wordId)
    .single();
  if (fetchErr || !card) throw new Error(fetchErr?.message ?? "Word not found");

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
          hsk_level: meta?.hsk_level ?? 1,
          flagged_for_immediate_use: true,
        },
        { onConflict: "user_id,hanzi", ignoreDuplicates: false }
      );
  }
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
    { onConflict: "user_id,hanzi", ignoreDuplicates: true }
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
    .upsert(rows, { onConflict: "user_id,hanzi", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
