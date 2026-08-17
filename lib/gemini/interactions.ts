const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

// Primary model everything tries first; falls back to the older one only
// when the primary is specifically out of quota — not on any other failure
// (bad request, invalid key, model error, etc. should surface as-is rather
// than silently retrying against a different model).
export const GEMINI_PRIMARY_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";

function isQuotaExhausted(status: number, bodyText: string): boolean {
  if (status === 429) return true;
  return /RESOURCE_EXHAUSTED|quota/i.test(bodyText);
}

/**
 * POSTs to the Gemini Interactions API with GEMINI_PRIMARY_MODEL, retrying
 * once against GEMINI_FALLBACK_MODEL if — and only if — the primary comes
 * back rate-limited/out-of-quota. `body` is everything except `model`
 * (this injects it). Returns a Response exactly like a plain `fetch` would —
 * callers keep their existing `!res.ok` / `res.json()` / `res.text()`
 * handling unchanged, they just don't know (and don't need to) which model
 * actually answered.
 */
export async function fetchGeminiInteractions(
  apiKey: string,
  body: Record<string, unknown>,
  opts?: { signal?: AbortSignal }
): Promise<Response> {
  const attempt = (model: string) =>
    fetch(INTERACTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ ...body, model }),
      signal: opts?.signal,
    });

  const primary = await attempt(GEMINI_PRIMARY_MODEL);
  if (primary.ok) return primary;

  const text = await primary.text().catch(() => "");
  if (!isQuotaExhausted(primary.status, text)) {
    // Not a quota issue — hand the original failure back untouched (as a
    // fresh Response, since the body stream above already got consumed) so
    // callers can still .text()/.json() it exactly once, same as normal.
    return new Response(text, { status: primary.status, statusText: primary.statusText, headers: primary.headers });
  }

  console.warn(`[gemini] ${GEMINI_PRIMARY_MODEL} out of quota, falling back to ${GEMINI_FALLBACK_MODEL}`);
  return attempt(GEMINI_FALLBACK_MODEL);
}
