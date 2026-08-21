import assert from 'node:assert/strict';
import fs from 'node:fs';

const overview = fs.readFileSync('assets/home-overview.js', 'utf8');
const fix = fs.readFileSync('assets/home-overview-leaflets-fix.js', 'utf8');

assert(overview.includes("observe('leafletGrid');"), 'Main overview must own leafletGrid observation.');
assert(overview.includes('new MutationObserver(schedule)'), 'Main overview must react to leafletGrid mutations.');
assert(!fix.includes('__slevaoOverviewLeafletsFixLoaded'), 'Legacy duplicate leaflet overview observer bootstrap must stay removed.');
assert(!fix.includes('function renderIfNeeded()'), 'Legacy duplicate leaflet clone retry loop must stay removed.');
assert(!fix.includes('MAX_RETRIES'), 'Legacy repeated leaflet retries must stay removed.');
assert(!fix.includes('RELOAD_AFTER'), 'Legacy forced reload retry layer must stay removed.');
assert.equal((fix.match(/new MutationObserver/g) || []).length, 1, 'Leaflet fix file should keep only the product-link observer.');
assert(fix.includes('function watchEndingSection()'), 'Lazy product-detail link behavior must remain intact.');

console.log('Homepage single leaflet observer OK');
