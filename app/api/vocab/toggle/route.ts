import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Add/remove a saved word — same operation as app/actions/vocabulary.ts's
 * logMistake / deleteWord, deliberately reimplemented as a plain Route
 * Handler instead of a Server Action so the client can call it with
 * `fetch(..., { keepalive: true })`.
 *
 * Why that matters: the popup's +/- toggle updates its UI optimistically and
 * fires this off without awaiting it in the click handler, so the user is
 * free to navigate away (or, on mobile, background the tab) the instant
 * after tapping — extremely common on a phone, much rarer on desktop where
 * people tend to sit on the page a beat longer. A plain Server Action call
 * is just a fetch with no special unload handling, so the browser can (and,
 * on mobile, reportedly did) kill it mid-flight: the popup shows "saved",
 * but the write never lands, and the word silently reverts to unsaved the
 * next time masteryMap loads. `keepalive: true` is the browser-standard fix
 * for exactly this — it guarantees the request is still sent even if the
 * page that started it is gone by the time the response would arrive.
 */
export async function POST(req: NextRequest) {
  const { action, id, hanzi, pinyin, meaning, hsk_level, is_slang } = await req.json().catch(() => ({}));
  if (!hanzi || (action !== "add" && action !== "remove")) {
    return NextResponse.json({ error: "hanzi and action (add|remove) required" }, { status: 400 });
  }

  const supabase = await createClient();
  const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (action === "add") {
    const { error } = await supabase.from("vocabulary_mastery").upsert(
      {
        user_id: userId,
        hanzi,
        pinyin: pinyin ?? "",
        meaning: meaning ?? "",
        hsk_level: hsk_level ?? null,
        is_slang: is_slang ?? false,
        flagged_for_immediate_use: true,
      },
      { onConflict: "user_id,hanzi,pinyin,meaning", ignoreDuplicates: false }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    let query = supabase.from("vocabulary_mastery").delete().eq("user_id", userId);
    query = id ? query.eq("id", id) : query.eq("hanzi", hanzi);
    if (!id && pinyin) query = query.eq("pinyin", pinyin);
    if (!id && meaning) query = query.eq("meaning", meaning);
    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
