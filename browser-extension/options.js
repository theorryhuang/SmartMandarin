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

// Reflects a connect that happened elsewhere — e.g. the settings page's
// "Connect Extension" button, which talks straight to background.js and
// finishes the connection without ever opening this page. Only matters if
// this options page happens to already be open when that happens.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(changes.serverUrl || changes.token)) return;
  load();
});

async function connect(serverUrl, token) {
  saveBtn.disabled = true;
  setStatus("Connecting…", "ok");
  try {
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
}

saveBtn.addEventListener("click", () => {
  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, "");
  const token = tokenInput.value.trim();
  if (!serverUrl || !token) {
    setStatus("Enter both a server URL and a token.", "err");
    return;
  }
  connect(serverUrl, token);
});
