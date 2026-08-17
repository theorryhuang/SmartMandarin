"use server";

import { createClient } from "@/lib/supabase/server";
import type { ConversationTurn } from "@/lib/types";

/**
 * Upsert an array of speaking turns into Supabase.
 * Safe to call with duplicates — (user_id, client_id) is unique.
 */
export async function saveSpeakingTurns(turns: ConversationTurn[], conversationId?: string): Promise<void> {
  if (turns.length === 0) return;
  const supabase = await createClient();
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;

  const rows = turns.map((t) => ({
    user_id: user.id,
    client_id: t.timestamp,
    role: t.role,
    raw_text: t.raw_text,
    tokens: t.tokens as unknown as import("@/lib/supabase/database.types").Json,
    conversation_id: conversationId ?? null,
  }));

  const { error } = await supabase
    .from("speaking_turns")
    .upsert(rows, { onConflict: "user_id,client_id", ignoreDuplicates: true });

  if (error) throw new Error(error.message);
}

/**
 * Load the most recent `limit` speaking turns from Supabase (optionally
 * scoped to one conversation), returned oldest-first so they render in order.
 */
export async function loadRecentSpeakingTurns(limit = 60, conversationId?: string): Promise<ConversationTurn[]> {
  const supabase = await createClient();
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];

  let query = supabase
    .from("speaking_turns")
    .select("client_id, role, raw_text, tokens, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .reverse()
    .map((r) => ({
      role: r.role as "user" | "assistant",
      raw_text: r.raw_text,
      tokens: r.tokens as unknown as ConversationTurn["tokens"],
      timestamp: r.client_id,
    }));
}

export interface SpeakingConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Reconstructs the speaking-conversation list from speaking_turns — same
 * approach as chat.ts's getConversationList(): there's no separate
 * conversations table, conversation_id + role/raw_text/created_at gets
 * grouped client-side into title/timestamps instead. Lets conversation
 * history survive a fresh device/browser/reinstalled PWA, all of which
 * start with empty local storage even though nothing was actually deleted.
 */
export async function getSpeakingConversationList(): Promise<SpeakingConversationSummary[]> {
  const supabase = await createClient();
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("speaking_turns")
    .select("conversation_id, role, raw_text, created_at")
    .eq("user_id", user.id)
    .not("conversation_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const byId = new Map<string, { title: string; hasTitle: boolean; createdAt: number; updatedAt: number }>();
  for (const row of data ?? []) {
    const id = row.conversation_id as string;
    const ts = new Date(row.created_at as string).getTime();
    let entry = byId.get(id);
    if (!entry) {
      entry = { title: "", hasTitle: false, createdAt: ts, updatedAt: ts };
      byId.set(id, entry);
    }
    entry.createdAt = Math.min(entry.createdAt, ts);
    entry.updatedAt = Math.max(entry.updatedAt, ts);
    // First user turn becomes the title, same rule as autoTitle() client-side.
    if (!entry.hasTitle && row.role === "user") {
      entry.title = row.raw_text.length > 28 ? row.raw_text.slice(0, 28) + "…" : row.raw_text;
      entry.hasTitle = true;
    }
  }

  return [...byId.entries()]
    .map(([id, v]) => ({ id, title: v.title, createdAt: v.createdAt, updatedAt: v.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
