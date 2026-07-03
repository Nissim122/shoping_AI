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
    return raw.map((it) => (typeof it === 'string' ? { name: it, quantity: 1, unit: null } : { name: it.name, quantity: it.quantity || 1, unit: it.unit || null }));
  }
  return argv.map((name) => ({ name, quantity: 1, unit: null }));
}

// The store's search endpoint doesn't do strict AND-matching on multi-word
// phrases — e.g. "חלב שוקולד" ranks plain milk above chocolate milk, since
// chocolate milk is actually named "שוקו" in the catalog. Blindly taking the
// first in-stock result silently adds the wrong product.
//
// For a single word we trust the store's own ranking (Hebrew has too much
// legitimate spelling variance — עגבנייה/עגבניה etc. — to require an exact
// substring match there). For multi-word phrases we require the qualifier
// word(s) — everything after the first, generic word — to actually appear
// in the candidate; if not one single in-stock result has them, the search
// likely missed the specific variant entirely, so flag it as unconfident
// instead of silently substituting something generic.
function pickBestMatch(items, phrase) {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  const inStock = items.filter((it) => it.IsInStock);
  if (!inStock.length) return { item: null, confident: false };

  if (words.length === 1) {
    return { item: inStock[0], confident: true };
  }

  const qualifiers = words.slice(1);
  const withQualifiers = inStock.filter((it) => qualifiers.every((w) => it.Name.includes(w)));
  if (withQualifiers.length) return { item: withQualifiers[0], confident: true };

  return { item: inStock[0], confident: false };
}

async function ensureSession() {
  if (hasSession()) return;
  console.log('No valid session found — opening browser for login...');
  await login();
}

// The app tracks weight-based items in its own units (ק"ג or גרם), which
// don't necessarily match hazi hinam's Type 2 (always ק"ג) — and the matched
// product may not even support the Type our app assumed (e.g. a jar of spice
// sold only by unit, Type 1, even though our app treats spices as "גרם").
// Sending an unsupported Type silently corrupts the real cart (it starts
// erroring on every read), so always check ItemQuantityTypes.Types first.
function resolveTypeAndQuantity({ unit, quantity }, best) {
  const types = best.ItemQuantityTypes?.Types || [];
  const supports = (t) => types.some((x) => x.Type === t);
  const wantsWeight = unit === 'ק"ג' || unit === 'גרם';

  if (wantsWeight && supports(2)) {
    return { type: 2, quantity: unit === 'גרם' ? quantity / 1000 : quantity };
  }
  if (!wantsWeight && supports(1)) {
    return { type: 1, quantity };
  }
  // Our app's assumed ordering mode isn't offered for this specific matched
  // product — fall back to whatever Type it does support. A unit<->weight
  // conversion can't be inferred, so default to a safe quantity of 1.
  if (supports(1)) return { type: 1, quantity: wantsWeight ? 1 : quantity };
  if (supports(2)) return { type: 2, quantity: wantsWeight ? (unit === 'גרם' ? quantity / 1000 : quantity) : 1 };
  return { type: best.IsShakil ? 2 : 1, quantity: 1 };
}

async function addOneItem({ name, quantity, unit }) {
  const res = await searchItem(name);
  const items = res.Results?.Items || [];
  const { item: best, confident } = pickBestMatch(items, name);
  if (!best) return { name, ok: false, reason: 'no search results' };
  if (!confident) return { name, ok: false, reason: `לא נמצאה התאמה בטוחה (הכי קרוב: "${best.Name}") — נסה לשנות את שם הפריט ברשימה` };
  const resolved = resolveTypeAndQuantity({ unit, quantity }, best);
  await addItemToCart(best.Id, resolved.quantity, resolved.type);
  return { name, ok: true, matched: best.Name, id: best.Id, price: best.Price_NET, quantity: resolved.quantity, unit: resolved.type === 2 ? 'ק"ג' : 'יח\'' };
}

async function addListToCart(entries) {
  const added = [];
  const failed = [];
  for (const entry of entries) {
    try {
      const result = await addOneItem(entry);
      if (result.ok) {
        added.push(result);
        console.log(`[✓] "${result.name}" -> "${result.matched}" ${result.quantity}${result.unit} (${result.price}₪)`);
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
            console.log(`[✓] "${retry.name}" -> "${retry.matched}" ${retry.quantity}${retry.unit} (${retry.price}₪) (after re-login)`);
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

  // Marker line the server can grab to report results back to the UI,
  // before the (potentially long-lived, until the user closes it) browser step.
  console.log('RESULTS_JSON:' + JSON.stringify({ added, failed }));

  await openCartInBrowser();
}

module.exports = { ensureSession, openCartInBrowser, addListToCart };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
