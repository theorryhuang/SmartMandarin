"use server";

import { createClient } from "@/lib/supabase/server";
import type { ConversationTurn } from "@/lib/types";

/**
 * Upsert an array of speaking turns into Supabase.
 * Safe to call with duplicates — (user_id, client_id) is unique.
 */
export async function saveSpeakingTurns(turns: ConversationTurn[]): Promise<void> {
  if (turns.length === 0) return;
  const supabase = await createClient();
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;

  const rows = turns.map((t) => ({
    user_id: user.id,
    client_id: t.timestamp,
    role: t.role,
    raw_text: t.raw_text,
    tokens: t.tokens,
  }));

  const { error } = await supabase
    .from("speaking_turns")
    .upsert(rows, { onConflict: "user_id,client_id", ignoreDuplicates: true });

  if (error) throw new Error(error.message);
}

/**
 * Load the most recent `limit` speaking turns from Supabase,
 * returned oldest-first so they render in order.
 */
export async function loadRecentSpeakingTurns(limit = 60): Promise<ConversationTurn[]> {
  const supabase = await createClient();
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("speaking_turns")
    .select("client_id, role, raw_text, tokens, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .reverse()
    .map((r) => ({
      role: r.role as "user" | "assistant",
      raw_text: r.raw_text,
      tokens: r.tokens as ConversationTurn["tokens"],
      timestamp: r.client_id,
    }));
}
