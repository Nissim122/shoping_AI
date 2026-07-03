// Checks current Hazi Hinam prices for a list of product names via the same
// search API used by run-list.js — read-only, nothing is added to any cart
// and no browser is opened (unless the saved session needs a fresh login).
// User-initiated only: triggered by a button click on the user's own list,
// never on a schedule.
//
// Usage:
//   node automation/hazi-hinam/check-prices.js "ביצים" "חלב"
//   node automation/hazi-hinam/check-prices.js --file path/to/items.json   ([{name}, ...] or ["name", ...])

const fs = require('fs');
const { searchItem, hasSession, AuthExpiredError } = require('./api-client');
const { login } = require('./record-session');

function parseArgs(argv) {
  const fileFlagIdx = argv.indexOf('--file');
  if (fileFlagIdx !== -1) {
    const filePath = argv[fileFlagIdx + 1];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return raw.map((it) => (typeof it === 'string' ? { name: it } : { name: it.name }));
  }
  return argv.map((name) => ({ name }));
}

function pickBestMatch(items) {
  return items.find((it) => it.IsInStock) || items[0];
}

// Weighed items (IsShakil, sold by ק"ג) are priced per kg via PricePerUnit —
// Price_NET on those is some arbitrary display weight, not "one" of anything.
// Everything else (pieces, or multi-item packs like a 6-pack of water) is
// priced as the whole matched unit via Price_NET, since the store's own
// catalog — not a guessed per-item split — defines what "one" is.
function resolvePrice(best) {
  if (best.IsShakil && best.MidaKod === 'ק"ג') {
    return { price: best.PricePerUnit, priceUnit: 'kg' };
  }
  return { price: best.Price_NET, priceUnit: 'piece' };
}

async function ensureSession() {
  if (hasSession()) return;
  console.log('No valid session found — opening browser for login...');
  await login();
}

async function checkOnePrice({ name }) {
  const res = await searchItem(name);
  const items = res.Results?.Items || [];
  const best = pickBestMatch(items);
  if (!best) return { name, ok: false, reason: 'no search results' };
  const { price, priceUnit } = resolvePrice(best);
  return { name, ok: true, matched: best.Name, id: best.Id, price, priceUnit };
}

// Small delay between requests — this is a manual, user-initiated check for
// a short list, not a bulk sweep, but there's no reason to hammer the
// endpoint back-to-back either.
const PACING_MS = 300;

async function checkPrices(entries) {
  const results = [];
  for (const entry of entries) {
    try {
      const result = await checkOnePrice(entry);
      results.push(result);
      if (result.ok) {
        console.log(`[✓] "${result.name}" -> "${result.matched}" (${result.price}₪${result.priceUnit === 'kg' ? '/ק"ג' : ''})`);
      } else {
        console.log(`[x] "${entry.name}": ${result.reason}`);
      }
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        console.log('Session expired mid-run — opening browser to re-login...');
        await login();
        try {
          const retry = await checkOnePrice(entry);
          results.push(retry);
          if (retry.ok) console.log(`[✓] "${retry.name}" -> "${retry.matched}" (${retry.price}₪${retry.priceUnit === 'kg' ? '/ק"ג' : ''}) (after re-login)`);
        } catch (e2) {
          results.push({ name: entry.name, ok: false, reason: e2.message });
          console.log(`[x] "${entry.name}" failed even after re-login: ${e2.message}`);
        }
        continue;
      }
      results.push({ name: entry.name, ok: false, reason: e.message });
      console.log(`[x] "${entry.name}" failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, PACING_MS));
  }
  return results;
}

async function main() {
  const entries = parseArgs(process.argv.slice(2));
  if (entries.length === 0) {
    console.error('Usage: node check-prices.js "item1" "item2" ...  OR  node check-prices.js --file items.json');
    process.exit(1);
  }

  await ensureSession();

  console.log(`Checking price for ${entries.length} item(s)...`);
  const results = await checkPrices(entries);

  console.log('RESULTS_JSON:' + JSON.stringify({ results }));
}

module.exports = { checkPrices, checkOnePrice, ensureSession, pickBestMatch, resolvePrice };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
