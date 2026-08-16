import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../assets/product-seo.js', import.meta.url), 'utf8');

assert.match(source, /function\s+canonicalProductUrl\s*\(/, 'Product SEO must build a canonical URL from product identity.');
assert.match(source, /searchParams\.set\('id',\s*id\)/, 'Canonical URL must preserve the product id.');
assert.match(source, /setCanonical\(canonical\)/, 'Canonical link must be updated before structured data is built.');
assert.match(source, /url:canonical/, 'Structured Product/Offer URLs must use the unique canonical URL.');
assert.match(source, /ensureMeta\('og:url',\s*canonical\)/, 'OpenGraph URL must match the canonical product URL.');

console.log('product-seo-canonical: ok');
