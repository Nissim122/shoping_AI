// Step 2 of the hybrid approach: reuse the session saved by record-session.js
// and talk to the site's backend directly (no browser, no clicking) to search
// for items — read-only, used for price lookups only.

const fs = require('fs');
const path = require('path');

const STORAGE_STATE = path.join(__dirname, 'storageState.json');
const BASE = 'https://shop.hazi-hinam.co.il/proxy/api';

function loadCookieHeader() {
  const state = JSON.parse(fs.readFileSync(STORAGE_STATE, 'utf8'));
  const relevant = state.cookies.filter((c) => c.domain.includes('hazi-hinam.co.il'));
  return relevant.map((c) => `${c.name}=${c.value}`).join('; ');
}

function hasSession() {
  if (!fs.existsSync(STORAGE_STATE)) return false;
  const state = JSON.parse(fs.readFileSync(STORAGE_STATE, 'utf8'));
  const auth = state.cookies.find((c) => c.name === 'H_Authentication');
  return !!auth && auth.expires * 1000 > Date.now();
}

class AuthExpiredError extends Error {
  constructor(status) {
    super(`session expired or invalid (HTTP ${status})`);
    this.name = 'AuthExpiredError';
  }
}

async function checkAuth(res) {
  if (res.status === 401 || res.status === 403) throw new AuthExpiredError(res.status);
}

function baseHeaders(cookieHeader) {
  const udid = '11111111-1111-1111-1111-111111111111';
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json; charset=UTF-8',
    DEVICE_INFO: JSON.stringify({ DEVICE_TYPE: 4, UDID: udid, MANUFACTURER: '', MODEL: '', VERSION: '' }),
    Cookie: cookieHeader || loadCookieHeader(),
  };
}

async function searchItem(phrase, cookieHeader) {
  const res = await fetch(`${BASE}/item/getItemsBySearch`, {
    method: 'POST',
    headers: baseHeaders(cookieHeader),
    body: JSON.stringify({ Paging: { Page: 1, PageSize: 20 }, Object: { SearchPhrase: phrase, SearchPhrases: null, ItemGroupping: 0 } }),
  });
  await checkAuth(res);
  if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// A plain (logged-out) visit to the site already gets a working session
// cookie for read-only search — no account/login required. Used so price
// checks don't need to touch the user's real account at all.
let cachedGuestCookieHeader = null;

async function ensureGuestSession(forceRefresh) {
  if (cachedGuestCookieHeader && !forceRefresh) return cachedGuestCookieHeader;
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://shop.hazi-hinam.co.il/', { waitUntil: 'networkidle', timeout: 30000 });
    const cookies = await context.cookies();
    cachedGuestCookieHeader = cookies
      .filter((c) => c.domain.includes('hazi-hinam.co.il'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    return cachedGuestCookieHeader;
  } finally {
    await browser.close();
  }
}

module.exports = { searchItem, hasSession, AuthExpiredError, ensureGuestSession };

if (require.main === module) {
  (async () => {
    const phrase = process.argv[2] || 'ביצים';
    console.log(`Searching for "${phrase}" via direct API call (no browser)...`);
    const results = await searchItem(phrase);
    const items = results.Results?.Items || [];
    console.log(`Got ${items.length} result(s). First few:`);
    for (const it of items.slice(0, 5)) {
      console.log(`  - Id=${it.Id} | ${it.Name} | ${it.Price_NET}₪`);
    }
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
