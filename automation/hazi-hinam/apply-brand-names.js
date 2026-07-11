// Merge step: takes one or more worker output files (see
// add-brand-names-worker.js) and writes the 'update' entries' newName back
// into index.html, by exact line number. Never touches lines it didn't get
// an 'update' result for. Prints a summary and a review list for anything
// not auto-applied.
//
// Usage: node automation/hazi-hinam/apply-brand-names.js --review-out <path> <outFile1> [outFile2 ...]

const fs = require('fs');
const path = require('path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');
const NAME_FIELD = /name:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/;

function escapeSingleQuoted(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function main() {
  let args = process.argv.slice(2);
  const reviewFlagIdx = args.indexOf('--review-out');
  let reviewFile = path.join(__dirname, 'brand-names-review.json');
  if (reviewFlagIdx !== -1) {
    reviewFile = args[reviewFlagIdx + 1];
    args = [...args.slice(0, reviewFlagIdx), ...args.slice(reviewFlagIdx + 2)];
  }
  const indexFlagIdx = args.indexOf('--index');
  let indexHtmlPath = INDEX_HTML;
  if (indexFlagIdx !== -1) {
    indexHtmlPath = args[indexFlagIdx + 1];
    args = [...args.slice(0, indexFlagIdx), ...args.slice(indexFlagIdx + 2)];
  }
  const outFiles = args;
  if (!outFiles.length) {
    console.error('Usage: node apply-brand-names.js [--review-out <path>] [--index <path>] <outFile1> [outFile2 ...]');
    process.exit(1);
  }

  const all = [];
  for (const f of outFiles) all.push(...JSON.parse(fs.readFileSync(f, 'utf8')));

  const byLine = new Map();
  for (const r of all) {
    if (byLine.has(r.line)) throw new Error(`Duplicate line ${r.line} across output files`);
    byLine.set(r.line, r);
  }

  const html = fs.readFileSync(indexHtmlPath, 'utf8');
  const lines = html.split('\n');

  const counts = {};
  const review = [];
  let applied = 0;

  for (const r of all) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (r.status === 'update') {
      const line = lines[r.line];
      const m = line.match(NAME_FIELD);
      if (!m) throw new Error(`Line ${r.line} doesn't look like a product line anymore: ${line}`);
      const currentName = m[1] !== undefined ? m[1] : m[2];
      if (currentName !== r.name) {
        review.push({ ...r, reason: 'name-changed-since-scan' });
        continue;
      }
      const quote = m[1] !== undefined ? "'" : '"';
      const escaped = quote === "'" ? escapeSingleQuoted(r.newName) : r.newName.replace(/"/g, '\\"');
      lines[r.line] = line.replace(NAME_FIELD, `name: ${quote}${escaped}${quote}`);
      applied++;
    } else if (r.status === 'low-confidence') {
      review.push(r);
    }
  }

  fs.writeFileSync(indexHtmlPath, lines.join('\n'), 'utf8');
  fs.writeFileSync(reviewFile, JSON.stringify(review, null, 2), 'utf8');

  console.log('Status counts:', counts);
  console.log(`Applied ${applied} name updates to index.html.`);
  console.log(`${review.length} entries need manual review -> ${reviewFile}`);
}

main();
