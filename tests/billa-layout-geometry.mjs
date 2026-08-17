import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../supabase/functions/sync-billa-products/index.ts', import.meta.url), 'utf8');

assert.match(source, /pageHeight=Math\.max\(842/, 'BILLA parser must retain PDF page height for geometry.');
assert.match(source, /layout_geometry/, 'BILLA candidates must retain layout geometry.');
assert.match(source, /purpose:'offer-region-hint-not-product-photo'/, 'Geometry must be explicitly marked as an offer-region hint, not a product photo.');
assert.match(source, /coordinate_space:'pdf-bottom-left'/, 'BILLA geometry must declare its coordinate system.');
assert.match(source, /band_left:round2\(band\.left\)/, 'BILLA geometry must retain the horizontal offer band.');
assert.match(source, /anchor_x:round2\(a\.x\)/, 'BILLA geometry must retain the verified price-label anchor.');
assert.match(source, /price_token:\{x:round2\(p\.t\.x\)/, 'BILLA geometry must retain the verified main-price token box.');
assert.match(source, /verification:verifiedBy/, 'Existing deterministic price verification must remain intact.');
assert.match(source, /if\(body\.dry_run===false\)await write/, 'BILLA parser must remain dry-run by default.');

console.log('billa-layout-geometry: ok');
