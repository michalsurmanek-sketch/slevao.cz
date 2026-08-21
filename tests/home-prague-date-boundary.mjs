import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = [
  'assets/home-leaflet-covers.js',
  'assets/home-overview.js',
  'assets/home-overview-leaflets-fix.js',
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  assert(!source.includes("new Date().toISOString().slice(0, 10)"), `${file} must not derive the business day from UTC.`);
  assert(source.includes("timeZone: 'Europe/Prague'"), `${file} must derive TODAY in the Europe/Prague timezone.`);
  assert(source.includes("new Intl.DateTimeFormat('en-CA'"), `${file} must use a stable YYYY-MM-DD formatter for Prague.`);
}

console.log('Homepage Prague date boundary OK');
