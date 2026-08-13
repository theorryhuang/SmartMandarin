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

  try {
    const res = await fetch(normalizeUrl(serverUrl) + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: "api-error", status: res.status, message: json.error };
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, reason: "network", message: String(e) };
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
    if (!res.ok) return { ok: false, message: `Server responded ${res.status}` };
    const json = await res.json();
    return { ok: true, savedWords: json.savedWords || {} };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
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
  })();
  return true; // keep the message channel open for the async response
});
