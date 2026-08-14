// Service worker — the only place that talks to the SmartMandarin API.
// content.js (untrusted third-party page context) never sees the token or
// does cross-origin fetches itself; it just messages this worker and gets
// plain data back. Requires host_permissions for the server's origin
// (granted via chrome.permissions.request in options.js) so these fetches
// bypass CORS entirely rather than depending on the server's CORS headers.

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
