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

const overview = fs.readFileSync('assets/home-overview.js', 'utf8');
assert(!overview.includes('const TODAY ='), 'Overview ending labels must not freeze the Prague business day at page startup.');
assert(overview.includes('const pragueToday = () => PRAGUE_DAY_FORMAT.format(new Date());'), 'Overview must derive the current Prague day on demand.');
assert(overview.includes('lastOverviewDay = pragueToday();'), 'Successful overview refreshes must remember the Prague calendar day.');
assert(overview.includes('today !== lastOverviewDay || Date.now() - lastOverviewRefreshAt >= DATA_REFRESH_MS'), 'Returning across Prague midnight must refresh overview data even inside the normal time TTL.');
assert(!overview.includes("new Date(`${value}T12:00:00`)"), 'Ending-day distance must not depend on browser-local Date arithmetic.');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `${name}() must exist.`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name}() body is incomplete.`);
}

const calendarOrdinal = new Function(`${extractFunction(overview, 'calendarOrdinal')}; return calendarOrdinal;`)();
assert.equal(calendarOrdinal('2026-10-26') - calendarOrdinal('2026-10-25'), 1, 'Autumn DST transition must still be exactly one calendar day.');
assert.equal(calendarOrdinal('2026-03-30') - calendarOrdinal('2026-03-29'), 1, 'Spring DST transition must still be exactly one calendar day.');

console.log('Homepage Prague date boundary OK');
