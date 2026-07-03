// One-time (re-runnable) scan over the app's local product catalog
// (PRODUCTS in index.html): looks up each product's real Hazi Hinam price
// and writes it straight back into index.html, so the shopping list can
// show/total prices instantly without a live lookup every time it's opened.
// User-initiated only — never on a schedule.
//
// Usage: node automation/hazi-hinam/update-prices.js

const fs = require('fs');
const path = require('path');
const { searchItem, hasSession, AuthExpiredError } = require('./api-client');
const { login } = require('./record-session');
const { pickBestMatch, resolvePrice } = require('./check-prices');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');
const PACING_MS = 300;
const CHECKPOINT_EVERY = 20;
const PRODUCT_LINE = /^\s*\{\s*name:\s*(?:'([^']*)'|"([^"]*)")/;

async function ensureSession() {
  if (hasSession()) return;
  console.log('No valid session found — opening browser for login...');
  await login();
}

async function scanOne(name) {
  const res = await searchItem(name);
  const items = res.Results?.Items || [];
  const best = pickBestMatch(items);
  if (!best) return null;
  return resolvePrice(best);
}

function upsertField(line, field, valueLiteral) {
  const re = new RegExp(`\\b${field}:\\s*[^,}]+`);
  if (re.test(line)) return line.replace(re, `${field}: ${valueLiteral}`);
  return line.replace(/\}(\s*,?\s*)$/, `, ${field}: ${valueLiteral} }$1`);
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

  await ensureSession();

  let scanned = 0;
  let found = 0;
  const missing = [];

  for (let i = startIdx; i <= endIdx; i++) {
    const m = lines[i].match(PRODUCT_LINE);
    if (!m) continue;
    const name = m[1] !== undefined ? m[1] : m[2];
    scanned++;

    let result;
    try {
      result = await scanOne(name);
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        console.log('Session expired mid-scan — opening browser to re-login...');
        await login();
        try {
          result = await scanOne(name);
        } catch (e2) {
          console.log(`[x] "${name}": ${e2.message}`);
          missing.push(name);
          continue;
        }
      } else {
        console.log(`[x] "${name}": ${e.message}`);
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
    lines[i] = line;
    found++;
    console.log(`[✓] "${name}" -> ${result.price}₪${result.priceUnit === 'kg' ? '/ק"ג' : ''}`);

    if (found % CHECKPOINT_EVERY === 0) {
      fs.writeFileSync(INDEX_HTML, lines.join('\n'), 'utf8');
    }

    await new Promise((r) => setTimeout(r, PACING_MS));
  }

  fs.writeFileSync(INDEX_HTML, lines.join('\n'), 'utf8');
  console.log(`\nDone: ${found}/${scanned} products priced.`);
  if (missing.length) console.log(`Missing (${missing.length}): ${missing.join(', ')}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { scanOne };
