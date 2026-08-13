import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { authenticateExtensionRequest, EXTENSION_CORS_HEADERS } from "@/lib/extensionAuth";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: EXTENSION_CORS_HEADERS });
}

/**
 * Add/remove a review card from the extension popup's +/- button. Mirrors
 * app/actions/vocabulary.ts's logMistake / removeFromReviewQueue, just
 * reimplemented against the service-role client since there's no session
 * cookie to authenticate those server actions with here.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await authenticateExtensionRequest(req);
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: EXTENSION_CORS_HEADERS });
    }

    const { hanzi, pinyin, meaning, hsk_level, id, action } = await req.json().catch(() => ({}));
    if (!hanzi || (action !== "add" && action !== "remove")) {
      return NextResponse.json({ error: "hanzi and action (add|remove) required" }, { status: 400, headers: EXTENSION_CORS_HEADERS });
    }

    const supabase = createServiceClient();

    if (action === "add") {
      const { error } = await supabase.from("vocabulary_mastery").upsert(
        {
          user_id: userId,
          hanzi,
          pinyin: pinyin ?? "",
          meaning: meaning ?? "",
          hsk_level: hsk_level ?? null,
          flagged_for_immediate_use: true,
        },
        { onConflict: "user_id,hanzi,pinyin,meaning", ignoreDuplicates: false }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: EXTENSION_CORS_HEADERS });
    } else {
      let query = supabase
        .from("vocabulary_mastery")
        .update({ flagged_for_immediate_use: false })
        .eq("user_id", userId);
      query = id ? query.eq("id", id) : query.eq("hanzi", hanzi);
      if (!id && pinyin) query = query.eq("pinyin", pinyin);
      if (!id && meaning) query = query.eq("meaning", meaning);
      const { error } = await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: EXTENSION_CORS_HEADERS });
    }

    return NextResponse.json({ ok: true }, { headers: EXTENSION_CORS_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500, headers: EXTENSION_CORS_HEADERS }
    );
  }
}
