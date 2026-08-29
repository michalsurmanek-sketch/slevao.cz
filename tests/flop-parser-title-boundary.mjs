import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = new URL('../supabase/functions/sync-flop-pdf-products/index.ts', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(source, /function hasStandaloneUnit\(v: string\)/);
assert.match(source, /flop-pdf-spatial-unit-price-v4/);
assert.doesNotMatch(source, /\\b\(kg\|g\|ml\|l\)\\b/);

function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function hasStandaloneUnit(v) {
  return /(?:^|[\s=,;:(])(?:kg|g|ml|l)(?=$|[\s=,;:).])/i.test(clean(v));
}

assert.equal(hasStandaloneUnit('KRÁL SÝRŮ HERMELÍN'), false);
assert.equal(hasStandaloneUnit('KRÁL'), false);
assert.equal(hasStandaloneUnit('1 l = 290,83 Kč'), true);
assert.equal(hasStandaloneUnit('250 ml'), true);
assert.equal(hasStandaloneUnit('120 g'), true);
assert.equal(hasStandaloneUnit('Cena za kg'), true);

console.log('FLOP title/unit boundary regression OK');
