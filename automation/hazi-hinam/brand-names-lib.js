// Shared logic for the one-time brand-name-enrichment pass over PRODUCTS.
// Given a Hazi Hinam item's ManufacturerName, decide what (if anything) to
// append to our own product name.

const HEBREW_RE = /[֐-׿]/;
const STORE_LABEL_PREFIX = 'חצי חינם'; // the store's own private label, not a real brand

function extractHebrewBrand(manufacturerRaw) {
  const raw = (manufacturerRaw || '').trim();
  if (!raw) return '';
  const tokens = raw.split(/\s+/);
  const hebrewTokens = tokens.filter((t) => HEBREW_RE.test(t));
  const brand = hebrewTokens.length ? hebrewTokens.join(' ') : raw;
  return brand.trim();
}

// Returns the new name string, or null if nothing should change.
function buildNewName(currentName, manufacturerRaw) {
  const brand = extractHebrewBrand(manufacturerRaw);
  if (brand.length < 2) return null;
  if (brand.startsWith(STORE_LABEL_PREFIX)) return null;
  if (currentName.includes(brand)) return null;
  return `${currentName} (${brand})`;
}

module.exports = { extractHebrewBrand, buildNewName, HEBREW_RE, STORE_LABEL_PREFIX };
