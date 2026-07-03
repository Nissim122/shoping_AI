// Step 1 of the hybrid approach: open a real browser and let a human log in
// (phone + SMS OTP). Every call to the site's /proxy/api/ backend gets
// logged to captured-requests.jsonl, and the final cookies/localStorage get
// saved to storageState.json so future price-check runs can skip the login
// entirely and talk to the search API directly.
//
// Usage: node automation/hazi-hinam/record-session.js
// Then in the browser window that opens:
//   1. Log in with your phone number + SMS code
//   2. Pick your branch/store if asked
//   3. Close the browser window when done — everything is saved automatically

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const REQUESTS_LOG = path.join(OUT_DIR, 'captured-requests.jsonl');
const STORAGE_STATE = path.join(OUT_DIR, 'storageState.json');

async function login() {
  fs.writeFileSync(REQUESTS_LOG, '');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('/proxy/api/')) return;
    const entry = {
      time: new Date().toISOString(),
      method: req.method(),
      url,
      headers: req.headers(),
      postData: req.postData(),
    };
    fs.appendFileSync(REQUESTS_LOG, JSON.stringify(entry) + '\n');
  });

  await page.goto('https://shop.hazi-hinam.co.il/');

  console.log('\n=== Browser is open — please log in ===');
  console.log('1. Log in with your phone + SMS code');
  console.log('2. Select your branch if prompted');
  console.log('3. Close the browser window when you are done — session will be saved.\n');

  await context.storageState({ path: STORAGE_STATE }).catch(() => {});

  await new Promise((resolve) => {
    context.on('close', resolve);
    page.on('close', async () => {
      try {
        await context.storageState({ path: STORAGE_STATE });
      } catch (e) {}
      resolve();
    });
  });

  try {
    await context.storageState({ path: STORAGE_STATE });
  } catch (e) {}

  console.log(`Saved session to ${STORAGE_STATE}`);
  await browser.close().catch(() => {});
}

module.exports = { login, STORAGE_STATE };

if (require.main === module) {
  login();
}
