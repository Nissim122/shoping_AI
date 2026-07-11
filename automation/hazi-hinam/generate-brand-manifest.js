// One-time: extract every PRODUCTS entry (line number + name + price) from
// index.html into a flat JSON manifest, so the brand-name enrichment workers
// can each process their own slice without touching index.html until the
// final merge step.
//
// Usage: node automation/hazi-hinam/generate-brand-manifest.js <outFile>

const fs = require('fs');
const path = require('path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');
const PRODUCT_LINE = /^\s*\{\s*name:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,\s*category:\s*'([^']*)'/;
const PRICE_FIELD = /\bprice:\s*([0-9.]+)/;

function main() {
  const outFile = process.argv[2];
  if (!outFile) {
    console.error('Usage: node generate-brand-manifest.js <outFile>');
    process.exit(1);
  }

  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const lines = html.split('\n');
  const startIdx = lines.findIndex((l) => l.includes('const PRODUCTS = ['));
  if (startIdx === -1) throw new Error('PRODUCTS array not found');
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    if (endIdx !== -1) break;
  }
  if (endIdx === -1) throw new Error('Could not find end of PRODUCTS array');

  const manifest = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const m = lines[i].match(PRODUCT_LINE);
    if (!m) continue;
    const name = m[1] !== undefined ? m[1] : m[2];
    const priceMatch = lines[i].match(PRICE_FIELD);
    manifest.push({
      line: i,
      name,
      category: m[3],
      price: priceMatch ? parseFloat(priceMatch[1]) : null,
    });
  }

  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`Wrote ${manifest.length} entries to ${outFile}`);
}

main();
