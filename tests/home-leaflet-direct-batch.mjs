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

console.log('Homepage direct leaflet batching OK');
