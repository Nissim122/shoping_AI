---
name: run-app
description: Launch and drive this shopping-list app (static index.html served by server.js) with Playwright to verify UI behavior. Use whenever asked to run, start, screenshot, or verify a change in this app.
---

# Running & verifying the shopping-list app

This is a single-file Hebrew shopping-list app: all markup/CSS/JS lives in
[index.html](../../../index.html). `server.js` just serves that file statically
on port 3457. There is no build step.

## 1. Start the server

```bash
node server.js &
```

It listens on `http://localhost:3457`. `playwright.config.js` also has
`webServer` pointed at the same command with `reuseExistingServer: true`, so
`npm test` will reuse a server you already started, or start its own.

## 2. Run the existing Playwright suite

```bash
npm test          # headless run of tests/shopping.spec.js
npm run test:ui   # interactive UI mode
```

[tests/shopping.spec.js](../../../tests/shopping.spec.js) is the reference for
selectors and flows — read it before writing new ad-hoc checks.

## 3. Ad-hoc verification (screenshots / one-off behavior checks)

Playwright is a devDependency, so any script using `require('playwright')` or
`require('@playwright/test')` **must live inside this project directory**
(anywhere under the repo root) — Node resolves `node_modules` from the
script's own path, not `cwd`. Scripts written to an external scratchpad dir
will fail with `MODULE_NOT_FOUND`. Write the temp script directly under the
repo root (e.g. `verify-*.tmp.js`) and delete it when done.

Minimal pattern:

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3457');
  // ...drive the page...
  await page.screenshot({ path: 'out.png' });
  await browser.close();
})();
```

## Key selectors / app structure

- Tabs: `#tab-add` / `#tab-list` (buttons), `#panel-add` / `#panel-list`
  (content panels, toggled via `.hidden` class). `activeTab` JS variable
  tracks state; `switchTab('add'|'list')` is the only function that changes
  it — it is called **only** by the tab buttons themselves, never
  automatically after adding a product (confirmed intentional behavior).
- Add-product flow: `#add-input` (search box) → `.sugg-item` (suggestion
  results, click one) → `#confirm-section` appears with qty controls →
  `.btn-confirm.primary` ("הוסף לסל ✓") commits via `addConfirmed()`.
- After `addConfirmed()`: input clears, `#confirm-section` hides,
  `#search-section` reappears — user stays on the add-product tab.
- Shopping list panel: `#list-bottom-bar` (bulk actions, shown only in edit
  mode while on the list tab).
- Toasts confirm actions (`showToast(...)`) — useful to assert on in scripts.

## What "verified" looks like

Don't just load the page — drive the flow the change touches (type in
`#add-input`, click a `.sugg-item`, click `.btn-confirm.primary`) and check
both DOM state (`classList.contains('active'|'hidden')`) and a screenshot.
