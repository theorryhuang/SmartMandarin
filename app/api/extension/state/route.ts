import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { authenticateExtensionRequest, EXTENSION_CORS_HEADERS } from "@/lib/extensionAuth";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: EXTENSION_CORS_HEADERS });
}

/**
 * Lightweight account snapshot the extension caches locally: which senses
 * are already saved (so the popup shows "–" instead of "+"), keyed by
 * hanzi — mirrors the shape of MasteryMap (lib/types.ts) but only the
 * fields the popup actually needs.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await authenticateExtensionRequest(req);
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: EXTENSION_CORS_HEADERS });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("vocabulary_mastery")
      .select("id, hanzi, pinyin, meaning, hsk_level")
      .eq("user_id", userId)
      .limit(2000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: EXTENSION_CORS_HEADERS });

    const savedWords: Record<string, { id: string; pinyin: string; meaning: string; hsk_level: number | null }[]> = {};
    for (const row of data ?? []) {
      (savedWords[row.hanzi] ??= []).push({ id: row.id, pinyin: row.pinyin, meaning: row.meaning, hsk_level: row.hsk_level });
    }

    return NextResponse.json({ savedWords }, { headers: EXTENSION_CORS_HEADERS });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500, headers: EXTENSION_CORS_HEADERS }
    );
  }
}
