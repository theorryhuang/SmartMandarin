"use server";

import { createClient } from "@/lib/supabase/server";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
}

/**
 * Upsert an array of messages into Supabase.
 * Safe to call with duplicates — client_id uniqueness prevents double-inserts.
 */
export async function saveMessages(messages: ChatMessage[], conversationId?: string): Promise<void> {
  if (messages.length === 0) return;
  const supabase = await createClient();
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;

  const rows = messages.map((m) => ({
    user_id: user.id,
    client_id: m.id,
    role: m.role,
    content: m.content,
    conversation_id: conversationId ?? null,
  }));

  const { error } = await supabase
    .from("chat_messages")
    .upsert(rows, { onConflict: "user_id,client_id", ignoreDuplicates: true });

  if (error) throw new Error(error.message);
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Reconstructs the conversation list from chat_messages — there's no
 * separate conversations table, so conversation_id + role/content/created_at
 * is grouped client-side into title/timestamps instead.
 *
 * This is what's supposed to make conversation history survive a fresh
 * device, browser, or reinstalled home-screen PWA: those all start with
 * empty local storage, but the messages were written to this table all
 * along (see saveMessages, called on every send) — localStorage on its own
 * never reads them back, so without this the conversation list looked
 * permanently wiped even though nothing was actually deleted.
 */
export async function getConversationList(): Promise<ConversationSummary[]> {
  const supabase = await createClient();
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("chat_messages")
    .select("conversation_id, role, content, created_at")
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
    // First user message becomes the title, same rule as autoTitle() client-side.
    if (!entry.hasTitle && row.role === "user") {
      entry.title = row.content.length > 28 ? row.content.slice(0, 28) + "…" : row.content;
      entry.hasTitle = true;
    }
  }

  return [...byId.entries()]
    .map(([id, v]) => ({ id, title: v.title, createdAt: v.createdAt, updatedAt: v.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Load messages older than `beforeClientId`, newest-first up to `limit`.
 * Returns them in chronological order (oldest first).
 */
export async function loadOlderMessages(
  beforeClientId: string | null,
  conversationId?: string,
  limit = 100
): Promise<ChatMessage[]> {
  const supabase = await createClient();
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];

  let query = supabase
    .from("chat_messages")
    .select("client_id, role, content, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  if (beforeClientId) {
    // Get the created_at of the anchor message so we can fetch before it
    const { data: anchor } = await supabase
      .from("chat_messages")
      .select("created_at")
      .eq("user_id", user.id)
      .eq("client_id", beforeClientId)
      .single();

    if (anchor) {
      query = query.lt("created_at", anchor.created_at);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Reverse so they come back oldest-first
  return (data ?? [])
    .reverse()
    .map((r) => ({ id: r.client_id, role: r.role as "user" | "assistant", content: r.content }));
}
