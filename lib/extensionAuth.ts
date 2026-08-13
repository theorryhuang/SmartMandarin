import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

const TOKEN_PREFIX = "smtok_";

/** SHA-256 hex digest — only the hash is ever persisted, never the raw token. */
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** New raw token — shown to the user exactly once at creation time. */
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const random = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return TOKEN_PREFIX + random;
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/**
 * Resolves the `Authorization: Bearer <token>` header on an extension API
 * request to a user id. Returns null on any failure (missing/malformed
 * header, unknown token) — callers should respond 401.
 */
export async function authenticateExtensionRequest(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  const token = match[1];
  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const tokenHash = await hashToken(token);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("extension_tokens")
    .select("id, user_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!data) return null;

  // Best-effort — don't block the request on this write.
  supabase
    .from("extension_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return data.user_id;
}

/** CORS headers shared by every /api/extension/* route — bearer-token auth, no cookies involved, so a wide origin is safe. */
export const EXTENSION_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
