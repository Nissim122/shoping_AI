// One-off: learn the real URL the cart page lives at, by watching where
// the app navigates to when you click the cart icon yourself (direct
// navigation to a guessed URL like /cart returns 404 on this SPA).
//
// Usage: node automation/hazi-hinam/capture-cart-url.js
// Opens a logged-in browser on the homepage — click the cart icon, then
// close the browser window. The URL(s) visited get printed here.

const { chromium } = require('playwright');
const { STORAGE_STATE } = require('./record-session');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();

  const visited = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      visited.push(frame.url());
      console.log(`[nav] ${frame.url()}`);
    }
  });

  await page.goto('https://shop.hazi-hinam.co.il/');
  console.log('\nClick the cart icon in the app, then close the browser window.\n');

  await new Promise((resolve) => {
    context.on('close', resolve);
    page.on('close', resolve);
  });

  console.log('\nAll URLs visited:');
  visited.forEach((u) => console.log(' -', u));
  await browser.close().catch(() => {});
})();
