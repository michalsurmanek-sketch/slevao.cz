import assert from 'node:assert/strict';
import fs from 'node:fs';

const overview = fs.readFileSync('assets/home-overview.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert(overview.includes("observe('leafletGrid');"), 'Main overview must own leafletGrid observation.');
assert(overview.includes('new MutationObserver(schedule)'), 'Main overview must react to leafletGrid mutations.');
assert(!index.includes('assets/home-overview-leaflets-fix.js'), 'Homepage must not load the removed overview workaround.');
assert(!fs.existsSync('assets/home-overview-leaflets-fix.js'), 'Obsolete overview workaround file must stay deleted.');

console.log('Homepage single leaflet observer OK');
