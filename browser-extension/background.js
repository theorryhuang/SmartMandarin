// Service worker — the only place that talks to the SmartMandarin API.
// content.js (untrusted third-party page context) never sees the token or
// does cross-origin fetches itself; it just messages this worker and gets
// plain data back. These fetches rely on the server's own CORS headers
// (EXTENSION_CORS_HEADERS in lib/extensionAuth.ts — Access-Control-Allow-
// Origin: *, since auth here is a bearer token, not cookies, so a wide
// origin has no session-riding risk) — no host_permissions grant needed.

async function getStored(keys) {
  return chrome.storage.local.get(keys);
}

async function getConfig() {
  const { serverUrl, token, savedWords } = await getStored(["serverUrl", "token", "savedWords"]);
  return {
    serverUrl: serverUrl || "",
    connected: !!(serverUrl && token),
    savedWords: savedWords || {},
  };
}

function normalizeUrl(url) {
  return url.replace(/\/+$/, "");
}

async function apiFetch(path, options = {}) {
  const { serverUrl, token } = await getStored(["serverUrl", "token"]);
  if (!serverUrl || !token) return { ok: false, reason: "not-configured" };

  // Without this, a stalled server request (e.g. the AI dictionary fallback
  // hanging on Gemini) left the popup spinning on "…" forever with no way
  // out — nothing here ever bounded how long a lookup could take.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(normalizeUrl(serverUrl) + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: "api-error", status: res.status, message: json.error };
    return { ok: true, data: json };
  } catch (e) {
    const timedOut = e?.name === "AbortError";
    return { ok: false, reason: "network", message: timedOut ? "Request timed out" : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function lookup(hanzi) {
  return apiFetch("/api/extension/lookup", {
    method: "POST",
    body: JSON.stringify({ hanzi, slang_mode: false }),
  });
}

async function refreshState() {
  const result = await apiFetch("/api/extension/state", { method: "GET" });
  if (result.ok) {
    await chrome.storage.local.set({ savedWords: result.data.savedWords || {} });
  }
  return result;
}

async function queueToggle({ hanzi, pinyin, meaning, hsk_level, id, action }) {
  const result = await apiFetch("/api/extension/queue", {
    method: "POST",
    body: JSON.stringify({ hanzi, pinyin, meaning, hsk_level, id, action }),
  });
  if (result.ok) {
    // Optimistic local update so the popup badge flips instantly without a
    // full /state round trip.
    const { savedWords } = await getStored(["savedWords"]);
    const map = savedWords || {};
    const rows = map[hanzi] || [];
    if (action === "add") {
      if (!rows.some((r) => r.pinyin === pinyin && r.meaning === meaning)) {
        rows.push({ id: id || "", pinyin: pinyin || "", meaning: meaning || "", hsk_level: hsk_level ?? null });
      }
    } else {
      const idx = rows.findIndex((r) => r.pinyin === pinyin && r.meaning === meaning);
      if (idx !== -1) rows.splice(idx, 1);
    }
    map[hanzi] = rows;
    await chrome.storage.local.set({ savedWords: map });
  }
  return result;
}

async function testConnection(serverUrl, token) {
  try {
    const res = await fetch(normalizeUrl(serverUrl) + "/api/extension/state", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: json.error ? `${res.status}: ${json.error}` : `Server responded ${res.status}` };
    return { ok: true, savedWords: json.savedWords || {} };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

/**
 * Handles the SmartMandarin settings page's "Connect Extension" button,
 * which mints a token server-side and hands it here so the human never
 * sees/copies one. Reached via content.js relaying a window.postMessage from
 * the page (see content.js) rather than the page calling
 * chrome.runtime.sendMessage(extensionId, …) directly — that requires
 * declaring `externally_connectable`, whose `matches` patterns Chrome
 * rejects if they'd match every origin, and this is self-hostable so no
 * fixed domain can be baked in at build time. Going through content.js
 * (already injected on every page via <all_urls>) sidesteps that entirely.
 *
 * `sender` here comes from the browser, not from the message body — a page
 * can't spoof sender.tab.url — so the origin check below means a page can
 * only push a connect payload for *its own* origin, not one impersonating
 * another site.
 *
 * Finishes the connection outright — no options page, no extra click.
 * Earlier this only staged the token and opened options.html for the user
 * to press Connect there, because that click used to be required to grant
 * host_permissions via chrome.permissions.request. That grant turned out to
 * be unnecessary: the server already sends CORS headers permitting this
 * (see apiFetch's comment above), so a plain fetch from here works with no
 * privileged, gesture-gated API involved at all.
 */
async function connectFromSite({ serverUrl, token }, sender) {
  if (!serverUrl || !token) return { ok: false, reason: "invalid-payload" };
  let originOk = false;
  try {
    originOk = !!sender?.tab?.url && new URL(serverUrl).origin === new URL(sender.tab.url).origin;
  } catch {
    originOk = false;
  }
  if (!originOk) return { ok: false, reason: "origin-mismatch" };

  const result = await testConnection(serverUrl, token);
  if (!result.ok) return { ok: false, reason: "connect-failed", message: result.message };

  await chrome.storage.local.set({ serverUrl, token, savedWords: result.savedWords || {} });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Logged synchronously, before anything async — if this line never shows
  // up in the service worker's console for a highlight that's stuck
  // loading, the message from content.js isn't reaching this listener at
  // all (dead/asleep service worker), rather than anything below failing.
  console.log("[SmartMandarin] onMessage:", msg?.type, msg);
  (async () => {
    try {
      switch (msg?.type) {
        case "getConfig":
          sendResponse(await getConfig());
          break;
        case "lookup":
          sendResponse(await lookup(msg.hanzi));
          break;
        case "queue":
          sendResponse(await queueToggle(msg.payload));
          break;
        case "refreshState":
          sendResponse(await refreshState());
          break;
        case "testConnection":
          sendResponse(await testConnection(msg.serverUrl, msg.token));
          break;
        case "connectFromSite":
          sendResponse(await connectFromSite(msg, sender));
          break;
        default:
          sendResponse({ ok: false, reason: "unknown-message" });
      }
    } catch (e) {
      // Safety net: previously, any unexpected throw here (as opposed to
      // the ones already caught inside apiFetch/testConnection) meant
      // sendResponse was never called at all — the popup would spin on
      // "…" forever with nothing logged, since the throw was inside an
      // unawaited async IIFE.
      console.error("[SmartMandarin] handler threw:", e);
      sendResponse({ ok: false, reason: "internal-error", message: String(e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
