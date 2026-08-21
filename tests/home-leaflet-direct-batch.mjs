import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('assets/home-leaflet-direct.js', 'utf8');

assert(source.includes('async function fetchBatch(storeSlugs)'), 'Direct leaflet lookup must have one batch fetch path.');
assert(source.includes("store_slug: `in.(${safe.join(',')})`"), 'Direct leaflet lookup must batch store slugs with a PostgREST in() filter.');
assert(source.includes("select: 'store_slug,document_url,valid_from,valid_to'"), 'Batch response must include store identity and validity data.');
assert(!source.includes('async function queryLeaflet('), 'Legacy per-store leaflet query helper must stay removed.');
assert(!source.includes('store_slug: `eq.${storeSlug}`'), 'Direct leaflet lookup must not issue one REST request per store.');
assert.equal((source.match(/public_product_leaflet_locations\?\$\{params\}/g) || []).length, 1, 'Production code must have one batched leaflet-location fetch site.');
assert(source.includes('const current = candidates'), 'Batch selection must prefer a currently valid leaflet.');
assert(source.includes("String(row?.valid_from || '') > today"), 'Batch selection must retain the upcoming-leaflet fallback.');
assert(source.includes('const queued = new Set();'), 'Progressive card rendering must queue newly appearing stores without duplicate per-card calls.');
assert(source.includes('if (batchPromise) return batchPromise;'), 'Concurrent scans must share the in-flight batch pipeline.');

assert(!source.includes('const DAY_MS = 86400000'), 'Prague calendar offsets must not use fixed 24-hour arithmetic across DST.');
assert(source.includes('calendarDay.setUTCDate(calendarDay.getUTCDate() + offsetDays);'), 'Prague date offsets must use calendar-day arithmetic.');
assert(source.includes('const DIRECT_CACHE_TTL = 30 * 60 * 1000;'), 'Direct leaflet results must expire after 30 minutes.');
assert(source.includes('const REFRESH_CHECK_MS = 5 * 60 * 1000;'), 'Direct leaflet freshness must be checked at a lightweight five-minute cadence.');
assert(source.includes('entry.day !== today || Date.now() - entry.fetchedAt >= DIRECT_CACHE_TTL'), 'Direct leaflet cache must expire both at Prague midnight and by TTL.');
assert(source.includes('resetCardLink(card, storeSlug);\n        missing.push(storeSlug);'), 'A stale direct document link must fall back before it is refetched.');
assert(source.includes("document.addEventListener('visibilitychange'"), 'Returning to the homepage must re-check direct leaflet freshness.');

function extractFunction(name) {
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

const pragueDate = new Function(`${extractFunction('pragueDate')}; return pragueDate;`)();
const autumnDstStart = new Date('2026-10-24T22:30:00.000Z'); // 25 Oct 00:30 in Prague, before the 25-hour day ends.
assert.equal(pragueDate(0, autumnDstStart), '2026-10-25', 'Prague current date must be derived from the Europe/Prague zone.');
assert.equal(pragueDate(1, autumnDstStart), '2026-10-26', 'Adding one calendar day must survive the autumn DST transition.');
assert.equal(pragueDate(7, autumnDstStart), '2026-11-01', 'Seven-day upcoming window must remain seven Prague calendar days across DST.');

console.log('Homepage direct leaflet batching and freshness OK');
