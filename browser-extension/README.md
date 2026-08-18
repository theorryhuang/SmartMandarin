# SmartMandarin Popup Dictionary (browser extension)

Highlight Chinese text on any page (Wikipedia, news sites, etc.) and get the
same popup dictionary as the app — pinyin, meaning, queue for review, and a
link through to the full word page. No hover-based tokenization here (there's
no reliable word segmentation on arbitrary third-party DOM) — it looks up
exactly what you select, and the server decomposes multi-word selections into
their constituent words automatically.

## Load it (unpacked, dev)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this `extension/` folder.
2. In the app: **Profile → Browser extension** → **Connect Extension**. That's it — it mints a
   token server-side, hands it to the extension, and the extension connects with it
   immediately (see "How auth works" below). No token to copy, no extra click anywhere.
3. If that doesn't reach the extension (non-Chromium browser, content script not loaded on
   that tab yet, etc.), fall back to the manual flow: toolbar icon → **Settings** (or
   right-click the icon → Options), then **Profile → Browser extension → Advanced: manual
   token setup** in the app to generate a token, and paste it plus the server URL into the
   options page yourself.

## Use it

Drag-select (or double-click) any Chinese text on a page. A popup appears
near the selection with pinyin/meaning and a **+** to queue it for review.
Click the popup itself to open the full word page in a new tab.

## How auth works

The extension can't use your logged-in session cookie cross-origin, so it
authenticates with a personal access token instead (`Authorization: Bearer
smtok_…`), sent only to `/api/extension/*` routes. Revoke a token anytime
from **Profile → Browser extension** in the app.

You never have to see or type that token, though. The settings page's
**Connect Extension** button mints a token, then `window.postMessage`s it to
itself; `content.js` — already injected on every page via `<all_urls>` — is
listening and relays it to `background.js` over a normal
`chrome.runtime.sendMessage` (not `externally_connectable`: that manifest
key needs explicit domain match patterns, and Chrome rejects ones broad
enough to cover every origin, which is what this would need since the
server's domain isn't known at the extension's build time — this is
self-hosted). `background.js`'s `connectFromSite` handler checks the
relayed message's `sender.tab.url` — set by the browser, not the page —
against the `serverUrl` it's asked to connect to (so a page can only push a
connect payload for *its own* origin, not spoof another site's), calls the
server itself to verify the token, and only then saves it and acks — no
options page opens, no click happens inside the extension's own UI at all.

That last part used to need a click: fetches from background.js to
`/api/extension/*` used to go through `chrome.permissions.request`-granted
`host_permissions`, and granting a permission requires a real user gesture
inside the extension's own UI — a background message can't fake one. It
turned out to be unnecessary — the server already sends CORS headers
permitting these fetches (`EXTENSION_CORS_HEADERS` in
`lib/extensionAuth.ts`, `Access-Control-Allow-Origin: *` — safe here since
auth is a bearer token, not cookies, so there's no session to ride along)
— so a plain `fetch()` from background.js works on its own, and
`host_permissions` was dropped from `manifest.json` entirely.

`manifest.json` also pins a fixed extension id via `"key"`, so every install
of this zip gets the same id instead of the path-derived one Load unpacked
would otherwise assign per machine. Not required by the flow above anymore,
but changing/removing it now would reset everyone's `chrome.storage.local`
again (an id change looks like a different extension to Chrome) — so leave
it alone.
