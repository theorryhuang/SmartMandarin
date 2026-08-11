# SmartMandarin Search — browser extension

Right-click selected text → "Search '…' on SmartMandarin" (or "使用汉智查搜索…",
auto-localized to the browser's display language) → opens
`https://smart-mandarin.vercel.app/vocab?q=<selection>` in a new tab.

## Install (Chrome / Edge / Brave / Arc — unpacked)

1. Go to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top right).
3. **Load unpacked** → select this `browser-extension/` folder.
4. Highlight Chinese text on any page → right-click → the menu item appears.

## Publish it properly (optional)

Zip this folder's contents (not the folder itself) and upload to the
[Chrome Web Store dev dashboard](https://chrome.google.com/webstore/devconsole)
or [Edge Add-ons dashboard](https://partner.microsoft.com/dashboard/microsoftedge/overview)
if you want it installable without dev mode.

## Changing the target domain

Edit `SITE_URL` in [background.js](background.js).

## Firefox

Firefox's MV3 `background.service_worker` support varies by version. If it
doesn't load as-is, swap the `background` key in `manifest.json` for:
```json
"background": { "scripts": ["background.js"] }
```

## iOS / iPadOS / macOS (no browser extension API for context menus)

Safari doesn't let web apps add items to the native selection menu or
right-click Services menu — that requires a Shortcuts-app action instead.
One-time setup, then it shows up in the Share Sheet (iOS/iPadOS) and the
Finder/system right-click **Services** menu (macOS):

1. Open the **Shortcuts** app → **+** → name it "SmartMandarin Search".
2. Add action **Get Text from Input** (Shortcut Input).
3. Add action **URL Encode** (Web/Text category) on that text.
4. Add action **Text**: `https://smart-mandarin.vercel.app/vocab?q=[encoded text from step 3]`
5. Add action **Open URLs** on that text.
6. Tap the shortcut's ⓘ (info) → **Use with Share Sheet** → set input type to
   **Text**. Give it the app icon/color you want here.
7. On macOS, also enable **Use as Quick Action** → **Services Menu** (Ventura+
   surfaces this automatically once Share Sheet is on, via System Settings →
   Keyboard → Keyboard Shortcuts → Services if it needs enabling).

Usage: highlight Chinese text anywhere (Safari, Notes, PDFs, Mail) → **Share**
(iOS/iPadOS) or right-click → **Services** (macOS) → **SmartMandarin Search**.
