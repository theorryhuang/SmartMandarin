const serverUrlInput = document.getElementById("serverUrl");
const tokenInput = document.getElementById("token");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function load() {
  const { serverUrl, token } = await chrome.storage.local.get(["serverUrl", "token"]);
  if (serverUrl) serverUrlInput.value = serverUrl;
  if (token) tokenInput.value = token;
  if (serverUrl && token) setStatus("Connected.", "ok");
}
load();

function originPattern(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

saveBtn.addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, "");
  const token = tokenInput.value.trim();

  if (!serverUrl || !token) {
    setStatus("Enter both a server URL and a token.", "err");
    return;
  }

  const pattern = originPattern(serverUrl);
  if (!pattern) {
    setStatus("That doesn't look like a valid URL.", "err");
    return;
  }

  saveBtn.disabled = true;
  setStatus("Connecting…", "ok");

  try {
    // Must be requested from a user-gesture context (this click handler) —
    // background.js can't request permissions on its own.
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      setStatus("Permission to access that server was denied.", "err");
      return;
    }

    const result = await chrome.runtime.sendMessage({ type: "testConnection", serverUrl, token });
    if (!result?.ok) {
      setStatus(result?.message || "Couldn't connect — check the URL and token.", "err");
      return;
    }

    await chrome.storage.local.set({ serverUrl, token, savedWords: result.savedWords || {} });
    setStatus("Connected! Highlight Chinese text on any page to try it.", "ok");
  } catch (e) {
    setStatus(String(e), "err");
  } finally {
    saveBtn.disabled = false;
  }
});
