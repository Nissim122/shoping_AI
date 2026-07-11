// One-time (re-runnable) scan over the drink-related entries in the app's
// local product catalog (PRODUCTS in index.html): looks up each product's
// real Hazi Hinam listing and writes back the correct price plus a `liters`
// field (from the store's own MidaKod/UnitSize fields) so the shopping list
// can show which pack size a price refers to, instead of an unmarked price
// that silently came from whichever pack size the search happened to match.
// Read-only lookups against the store's search API — same as update-prices.js.
// User-initiated only — never on a schedule.
//
// Usage: node automation/hazi-hinam/update-drinks-liters.js

const fs = require('fs');
const path = require('path');
const { searchItem, ensureGuestSession } = require('./api-client');
const { pickBestMatch, resolvePrice } = require('./check-prices');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');
const PACING_MS = 300;
const CHECKPOINT_EVERY = 20;
const LINE_RE = /^\s*\{\s*name:\s*(?:'([^']*)'|"([^"]*)")\s*,\s*category:\s*(?:'([^']*)'|"([^"]*)")/;

const DRINK_CATEGORY = 'משקאות';
const DAIRY_CATEGORY = 'מוצרי חלב וביצים';

function isTarget(name, category) {
  if (category === DRINK_CATEGORY) return true;
  if (category === DAIRY_CATEGORY && /^(ה)?חלב/.test(name)) return true;
  return false;
}

// pickBestMatch only checks that every search word appears somewhere in the
// candidate's name, with no idea what the product actually is — searching
// "חלב שקדים" (almond milk) can match "שוקולד חלב עם שקדים שלמים" (a
// chocolate bar) purely because both words happen to appear in its name.
// Restricting the candidate pool to Hazi Hinam's own drink-shaped
// categories up front keeps that kind of cross-department false match out
// (worth an occasional "no results" over a silently wrong product/price).
const ALLOWED_CATEGORIES = new Set(['משקאות', 'מוצרי חלב וביצים', 'הצמחוניה', 'קפה, תה ואבקות שתיה']);

// The store's own catalog marks liquid items with MidaKod === 'ליטר' or
// 'מ"ל' and gives the exact pack size in UnitSize (e.g. 1.5 for a 1.5-liter
// bottle, or 500 for a 500ml can) — for multi-packs this is the pack's total
// volume, matching how Price_NET is the price for the whole pack. Non-liquid
// items (capsules, tea bags, ground coffee) use other MidaKod values, so
// this naturally only fires for things actually sold by volume.
function resolveLiters(best) {
  if (typeof best.UnitSize !== 'number' || best.UnitSize <= 0) return null;
  if (best.MidaKod === 'ליטר') return best.UnitSize;
  if (best.MidaKod === 'מ"ל') return Math.round((best.UnitSize / 1000) * 1000) / 1000;
  return null;
}

async function scanOne(name, guestCookie) {
  const res = await searchItem(name, guestCookie);
  const items = (res.Results?.Items || []).filter((it) => ALLOWED_CATEGORIES.has(it.CategoryName));
  const best = pickBestMatch(items, name);
  if (!best) return null;
  return { ...resolvePrice(best), liters: resolveLiters(best), matched: best.Name };
}

function upsertField(line, field, valueLiteral) {
  const re = new RegExp(`\\b${field}:\\s*[^,}]+`);
  if (re.test(line)) return line.replace(re, `${field}: ${valueLiteral}`);
  return line.replace(/\}(\s*,?\s*)$/, `, ${field}: ${valueLiteral} }$1`);
}

function removeField(line, field) {
  const re = new RegExp(`,?\\s*\\b${field}:\\s*[^,}]+`);
  return line.replace(re, '');
}

function findProductsRange(lines) {
  const startIdx = lines.findIndex((l) => l.includes('const PRODUCTS = ['));
  if (startIdx === -1) throw new Error('PRODUCTS array not found in index.html');
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) return { startIdx, endIdx: i };
      }
    }
  }
  throw new Error('Could not find end of PRODUCTS array');
}

async function main() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const lines = html.split('\n');
  const { startIdx, endIdx } = findProductsRange(lines);

  let guestCookie = await ensureGuestSession();

  let scanned = 0;
  let found = 0;
  let withLiters = 0;
  const missing = [];

  for (let i = startIdx; i <= endIdx; i++) {
    const m = lines[i].match(LINE_RE);
    if (!m) continue;
    const name = m[1] !== undefined ? m[1] : m[2];
    const category = m[3] !== undefined ? m[3] : m[4];
    if (!isTarget(name, category)) continue;
    scanned++;

    let result;
    try {
      result = await scanOne(name, guestCookie);
    } catch (e) {
      // A blip (or the guest session going stale) shouldn't lose an item —
      // grab a fresh guest cookie and retry once before giving up on it.
      try {
        guestCookie = await ensureGuestSession(true);
        await new Promise((r) => setTimeout(r, 1000));
        result = await scanOne(name, guestCookie);
      } catch (e2) {
        console.log(`[x] "${name}": ${e2.message}`);
        missing.push(name);
        continue;
      }
    }

    if (!result) {
      console.log(`[x] "${name}": no search results`);
      missing.push(name);
      continue;
    }

    let line = upsertField(lines[i], 'price', String(result.price));
    line = upsertField(line, 'priceUnit', `'${result.priceUnit}'`);
    line = result.liters != null ? upsertField(line, 'liters', String(result.liters)) : removeField(line, 'liters');
    lines[i] = line;
    found++;
    if (result.liters != null) withLiters++;
    console.log(`[✓] "${name}" -> "${result.matched}" ${result.price}₪${result.priceUnit === 'kg' ? '/ק"ג' : ''}${result.liters != null ? ` (${result.liters} ליטר)` : ''}`);

    if (found % CHECKPOINT_EVERY === 0) {
      fs.writeFileSync(INDEX_HTML, lines.join('\n'), 'utf8');
    }

    await new Promise((r) => setTimeout(r, PACING_MS));
  }

  fs.writeFileSync(INDEX_HTML, lines.join('\n'), 'utf8');
  console.log(`\nDone: ${found}/${scanned} products priced, ${withLiters} with a liters value.`);
  if (missing.length) console.log(`Missing (${missing.length}): ${missing.join(', ')}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { scanOne, isTarget, resolveLiters };
