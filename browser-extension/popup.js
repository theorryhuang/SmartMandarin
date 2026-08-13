const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const serverEl = document.getElementById("server");

async function refreshStatus() {
  const config = await chrome.runtime.sendMessage({ type: "getConfig" });
  dot.className = `dot ${config.connected ? "on" : "off"}`;
  statusText.textContent = config.connected ? "Connected" : "Not connected";
  serverEl.textContent = config.serverUrl || "";
}
refreshStatus();

document.getElementById("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("refresh").addEventListener("click", async (e) => {
  e.target.textContent = "Refreshing…";
  const result = await chrome.runtime.sendMessage({ type: "refreshState" });
  e.target.textContent = result?.ok ? "Refreshed ✓" : "Refresh failed";
  setTimeout(() => { e.target.textContent = "Refresh saved words"; }, 1500);
});
