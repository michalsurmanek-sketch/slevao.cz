import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = [
  'assets/home-leaflet-covers.js',
  'assets/home-overview.js',
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  assert(!source.includes("new Date().toISOString().slice(0, 10)"), `${file} must not derive the business day from UTC.`);
  assert(source.includes("timeZone: 'Europe/Prague'"), `${file} must derive TODAY in the Europe/Prague timezone.`);
  assert(source.includes("new Intl.DateTimeFormat('en-CA'"), `${file} must use a stable YYYY-MM-DD formatter for Prague.`);
}

const covers = fs.readFileSync('assets/home-leaflet-covers.js', 'utf8');
assert(!covers.includes('const TODAY ='), 'Leaflet cover validity must not freeze the Prague business day at page startup.');
assert(covers.includes('const pragueToday = () => PRAGUE_DAY_FORMAT.format(new Date());'), 'Leaflet covers must derive the current Prague day on demand.');
assert.equal((covers.match(/const today = pragueToday\(\);/g) || []).length, 2, 'Both cached and freshly fetched leaflet validity checks must use the current Prague day.');
assert(!/valid_(?:from|to)[^\n]*TODAY/.test(covers), 'Leaflet validity comparisons must not use a startup-day constant.');

console.log('Homepage Prague date boundary OK');
