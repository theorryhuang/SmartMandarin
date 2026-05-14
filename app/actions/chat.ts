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
