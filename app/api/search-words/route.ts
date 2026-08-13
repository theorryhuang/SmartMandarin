import { NextRequest, NextResponse } from "next/server";
import { cedictSearch } from "@/lib/cedict";
import { createClient } from "@/lib/supabase/server";
import { senseKey } from "@/lib/senseKey";

export async function POST(req: NextRequest) {
  const { query, mode } = await req.json().catch(() => ({}));
  if (!query || !query.trim()) return NextResponse.json({ results: [] });

  const results = await cedictSearch(query.trim(), mode === "english" ? "english" : "chinese");
  if (results.length === 0) return NextResponse.json({ results: [] });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Per-sense, not per-hanzi — a hanzi can have multiple saved senses now,
  // and a result should only show "already saved" for the sense it actually is.
  let savedSet = new Set<string>();
  if (user) {
    const { data: saved } = await supabase
      .from("vocabulary_mastery")
      .select("hanzi, pinyin, meaning")
      .eq("user_id", user.id)
      .in("hanzi", results.map((r) => r.hanzi));
    savedSet = new Set((saved ?? []).map((s) => senseKey(s)));
  }

  return NextResponse.json({
    results: results.map((r) => ({ ...r, already_saved: savedSet.has(senseKey(r)) })),
  });
}
