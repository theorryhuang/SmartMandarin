# SmartMandarin Popup Dictionary (browser extension)

Highlight Chinese text on any page (Wikipedia, news sites, etc.) and get the
same popup dictionary as the app — pinyin, meaning, queue for review, and a
link through to the full word page. No hover-based tokenization here (there's
no reliable word segmentation on arbitrary third-party DOM) — it looks up
exactly what you select, and the server decomposes multi-word selections into
their constituent words automatically.

## Load it (unpacked, dev)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this `extension/` folder.
2. Click the toolbar icon → **Settings** (or right-click the icon → Options).
3. In the app: **Profile → Browser extension** → generate a token, copy it.
4. Paste the server URL (e.g. `http://localhost:3000` while developing) and the token into the options page → **Connect**.

## Use it

Drag-select (or double-click) any Chinese text on a page. A popup appears
near the selection with pinyin/meaning and a **+** to queue it for review.
Click the popup itself to open the full word page in a new tab.

## How auth works

The extension can't use your logged-in session cookie cross-origin, so it
authenticates with a personal access token instead (`Authorization: Bearer
smtok_…`), sent only to `/api/extension/*` routes. Revoke a token anytime
from **Profile → Browser extension** in the app.
