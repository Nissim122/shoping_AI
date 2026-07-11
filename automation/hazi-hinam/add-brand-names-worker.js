// Worker for the brand-name enrichment pass: takes a slice of the product
// manifest (see generate-brand-manifest.js), looks each item up on Hazi
// Hinam the same way update-prices.js does, and decides whether to append a
// manufacturer brand to the name. Writes results incrementally so a chunk
// can be resumed if interrupted. Read-only against the site — no cart, no
// login required beyond the existing saved session.
//
// Usage: node automation/hazi-hinam/add-brand-names-worker.js <chunkFile> <outFile>

const fs = require('fs');
const { searchItem, hasSession, AuthExpiredError } = require('./api-client');
const { pickBestMatch, resolvePrice } = require('./check-prices');
const { buildNewName } = require('./brand-names-lib');

const PACING_MS = 350;
const CHECKPOINT_EVERY = 25;

async function processOne(entry) {
  const res = await searchItem(entry.name);
  const items = res.Results?.Items || [];
  const best = pickBestMatch(items, entry.name);
  if (!best) return { line: entry.line, name: entry.name, status: 'no-match' };

  const resolved = resolvePrice(best);
  const priceMatch = entry.price == null ? null : Math.abs(resolved.price - entry.price) < 0.05;
  const exactNameMatch = best.Name === entry.name;
  const newName = buildNewName(entry.name, best.ManufacturerName);

  if (!newName) {
    return {
      line: entry.line,
      name: entry.name,
      status: 'skip',
      matched: best.Name,
      manufacturer: best.ManufacturerName,
      priceMatch,
    };
  }

  // Only auto-apply when the matched item's name is a verbatim match.
  // Price alone isn't a reliable enough confidence signal — two unrelated
  // items can coincidentally share a price point (e.g. plain "סוכר" landing
  // on "טרוביה תחליף סוכר חום", a stevia sweetener, at the same ₪ figure).
  // Everything else goes to a review queue instead of risking a wrong label.
  if (!exactNameMatch) {
    return {
      line: entry.line,
      name: entry.name,
      status: 'low-confidence',
      matched: best.Name,
      manufacturer: best.ManufacturerName,
      wouldBe: newName,
      priceMatch,
    };
  }

  return {
    line: entry.line,
    name: entry.name,
    newName,
    status: 'update',
    matched: best.Name,
    manufacturer: best.ManufacturerName,
    priceMatch,
  };
}

async function main() {
  const [chunkFile, outFile] = process.argv.slice(2);
  if (!chunkFile || !outFile) {
    console.error('Usage: node add-brand-names-worker.js <chunkFile> <outFile>');
    process.exit(1);
  }
  if (!hasSession()) {
    console.error('No valid Hazi Hinam session found (storageState.json missing/expired). Aborting.');
    process.exit(1);
  }

  const chunk = JSON.parse(fs.readFileSync(chunkFile, 'utf8'));

  let results = [];
  const doneLines = new Set();
  if (fs.existsSync(outFile)) {
    results = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    for (const r of results) doneLines.add(r.line);
    console.log(`Resuming: ${results.length} already done in this chunk.`);
  }

  let processed = 0;
  for (const entry of chunk) {
    if (doneLines.has(entry.line)) continue;

    let result;
    try {
      result = await processOne(entry);
    } catch (e) {
      if (e instanceof AuthExpiredError) {
        console.error(`Session expired at line ${entry.line}. Stopping this chunk — rerun to resume once the session is refreshed.`);
        break;
      }
      result = { line: entry.line, name: entry.name, status: 'error', error: e.message };
    }

    results.push(result);
    processed++;
    const tag = result.status === 'update' ? '✓' : result.status === 'skip' ? '-' : result.status === 'low-confidence' ? '?' : 'x';
    console.log(`[${tag}] line ${entry.line} "${entry.name}" -> ${result.newName || result.status}`);

    if (processed % CHECKPOINT_EVERY === 0) {
      fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
    }
    await new Promise((r) => setTimeout(r, PACING_MS));
  }

  fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Done. ${results.length}/${chunk.length} entries processed in this chunk.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
