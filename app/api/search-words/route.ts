import { NextRequest, NextResponse } from "next/server";
import { cedictSearch } from "@/lib/cedict";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const { query } = await req.json().catch(() => ({}));
  if (!query || !query.trim()) return NextResponse.json({ results: [] });

  const results = await cedictSearch(query.trim());
  if (results.length === 0) return NextResponse.json({ results: [] });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let savedSet = new Set<string>();
  if (user) {
    const { data: saved } = await supabase
      .from("vocabulary_mastery")
      .select("hanzi")
      .eq("user_id", user.id)
      .in("hanzi", results.map((r) => r.hanzi));
    savedSet = new Set((saved ?? []).map((s) => s.hanzi));
  }

  return NextResponse.json({
    results: results.map((r) => ({ ...r, already_saved: savedSet.has(r.hanzi) })),
  });
}
