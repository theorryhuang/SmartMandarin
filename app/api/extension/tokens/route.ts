import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateToken, hashToken } from "@/lib/extensionAuth";

/**
 * Token management for the browser extension — cookie-authenticated (called
 * from the settings page you're logged into, not from the extension itself).
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("extension_tokens")
    .select("id, label, created_at, last_used_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { label } = await req.json().catch(() => ({ label: undefined }));

  const token = generateToken();
  const token_hash = await hashToken(token);

  const { data, error } = await supabase
    .from("extension_tokens")
    .insert({ user_id: user.id, token_hash, label: label || "Browser extension" })
    .select("id, label, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The only time the raw token is ever returned — the server never stores it.
  return NextResponse.json({ token, ...data });
}
