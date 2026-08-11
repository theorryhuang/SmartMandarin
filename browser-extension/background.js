// SmartMandarin — right-click search integration.
// Adds a "Search '%s' on SmartMandarin" item to the selection context menu.
// Selecting it opens the app's search page with the highlighted text.

const SITE_URL = "https://smart-mandarin.vercel.app";
const MENU_ID = "smartmandarin-search";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    // Message strings contain a literal "%s" — Chrome substitutes it with the
    // selected text (truncated) and localizes the title to the browser's
    // display language automatically via _locales/*.
    title: chrome.i18n.getMessage("contextMenuTitle"),
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = (info.selectionText ?? "").trim();
  if (!text) return;

  const url = `${SITE_URL}/vocab?q=${encodeURIComponent(text)}`;
  chrome.tabs.create({ url, index: (tab?.index ?? 0) + 1 });
});
