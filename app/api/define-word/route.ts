import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defineWord } from "@/lib/defineWord";

export async function POST(req: NextRequest) {
  const { hanzi, slang_mode } = await req.json().catch(() => ({}));
  if (!hanzi) return NextResponse.json({ error: "hanzi required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const result = await defineWord({ supabase, userId: user?.id ?? null, hanzi, slangMode: slang_mode });
  if (result.error) return NextResponse.json(result, { status: 500 });
  return NextResponse.json(result);
}
