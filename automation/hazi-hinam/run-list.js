// Adds a shopping list to the cart via direct API calls (fast, no clicking),
// refreshing the login automatically (via a headed browser) if the saved
// session has expired, then opens a real logged-in browser on the cart page
// so you can review everything and complete checkout yourself.
//
// Usage:
//   node automation/hazi-hinam/run-list.js "ביצים" "חלב" "לחם"          (quantity 1 each)
//   node automation/hazi-hinam/run-list.js --file path/to/items.json     ([{name, quantity}, ...])

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { searchItem, addItemToCart, hasSession, AuthExpiredError } = require('./api-client');
const { login, STORAGE_STATE } = require('./record-session');

// The cart is a client-side drawer opened by clicking the cart icon, not a
// dedicated route — a direct navigation to a guessed "/cart" URL 404s.
// Landing on the homepage is the correct, working final page.
const CART_URL = 'https://shop.hazi-hinam.co.il/';

function parseArgs(argv) {
  const fileFlagIdx = argv.indexOf('--file');
  if (fileFlagIdx !== -1) {
    const filePath = argv[fileFlagIdx + 1];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return raw.map((it) => (typeof it === 'string' ? { name: it, quantity: 1 } : { name: it.name, quantity: it.quantity || 1 }));
  }
  return argv.map((name) => ({ name, quantity: 1 }));
}

function pickBestMatch(items) {
  return items.find((it) => it.IsInStock) || items[0];
}

async function ensureSession() {
  if (hasSession()) return;
  console.log('No valid session found — opening browser for login...');
  await login();
}

async function addOneItem({ name, quantity }) {
  const res = await searchItem(name);
  const items = res.Results?.Items || [];
  const best = pickBestMatch(items);
  if (!best) return { name, ok: false, reason: 'no search results' };
  const type = best.IsShakil ? 2 : 1; // weight-sold items (fruit/veg, meat/fish, spices) use Type 2 (ק"ג) instead of Type 1 (יח')
  await addItemToCart(best.Id, quantity, type);
  return { name, ok: true, matched: best.Name, id: best.Id, price: best.Price_NET, quantity };
}

async function addListToCart(entries) {
  const added = [];
  const failed = [];
  for (const entry of entries) {
    try {
      const result = await addOneItem(entry);
      if (result.ok) {
        added.push(result);
        console.log(`[✓] "${result.name}" -> "${result.matched}" x${result.quantity} (${result.price}₪)`);
      } else {
        failed.push(result);
        console.log(`[x] "${entry.name}": ${result.reason}`);
      }
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        console.log('Session expired mid-run — opening browser to re-login...');
        await login();
        try {
          const retry = await addOneItem(entry);
          if (retry.ok) {
            added.push(retry);
            console.log(`[✓] "${retry.name}" -> "${retry.matched}" x${retry.quantity} (${retry.price}₪) (after re-login)`);
            continue;
          }
        } catch (e2) {
          failed.push({ name: entry.name, reason: e2.message });
          console.log(`[x] "${entry.name}" failed even after re-login: ${e2.message}`);
          continue;
        }
      }
      failed.push({ name: entry.name, reason: e.message });
      console.log(`[x] "${entry.name}" failed: ${e.message}`);
    }
  }
  return { added, failed };
}

// Deliberately no request/response listeners or page reads here — once the
// cart is handed to the user for manual payment, nothing should observe it.
async function openCartInBrowser() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STORAGE_STATE });
  const page = await context.newPage();
  await page.goto(CART_URL);
  console.log(`\nOpened ${CART_URL} — click the cart icon to review it and complete checkout yourself.`);
  console.log('Close the browser window when you are done.');
  await new Promise((resolve) => {
    context.on('close', resolve);
    page.on('close', resolve);
  });
  await browser.close().catch(() => {});
}

async function main() {
  const entries = parseArgs(process.argv.slice(2));
  if (entries.length === 0) {
    console.error('Usage: node run-list.js "item1" "item2" ...  OR  node run-list.js --file items.json');
    process.exit(1);
  }

  await ensureSession();

  console.log(`Adding ${entries.length} item(s) to cart via direct API...`);
  const { added, failed } = await addListToCart(entries);

  console.log(`\nDone: ${added.length} added, ${failed.length} failed.`);
  if (failed.length) {
    console.log('Failed items:', failed.map((f) => f.name).join(', '));
  }

  await openCartInBrowser();
}

module.exports = { ensureSession, openCartInBrowser, addListToCart };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
