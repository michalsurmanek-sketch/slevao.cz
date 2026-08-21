import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('assets/home-leaflet-covers.js', 'utf8');

assert(source.includes('/rest/v1/rpc/get_public_current_leaflets'), 'Homepage leaflet renderer must use the public current-leaflets RPC.');
assert(source.includes("method: 'POST'"), 'Current leaflet RPC must use POST.');
assert(source.includes('body: JSON.stringify({ p_limit: 240 })'), 'Current leaflet RPC must request a bounded public batch.');
assert(source.includes('Promise.all([activeStores(), currentLeaflets()])'), 'Store metadata and public leaflets must load in parallel.');
assert(source.includes('firstByStore.has(slug)'), 'RPC rows must be deduplicated to one preferred leaflet per store.');
assert(source.includes("marker(store, VISIBILITY_KEY) !== 'hidden'"), 'Homepage leaflet visibility markers must still be respected.');
assert(source.includes("marker(a, FORCE_KEY) === '1'"), 'Forced homepage leaflet priority must remain intact.');
assert(!source.includes('/functions/v1/store-leaflet-feed'), 'Homepage renderer must not fan out to store-leaflet-feed per store.');
assert(!source.includes('STORE_BATCH_SIZE'), 'Legacy per-store batch loop must stay removed.');
assert(!source.includes('function storeLeaflet('), 'Legacy per-store leaflet request helper must stay removed.');
assert(!source.includes('batch.map(storeLeaflet)'), 'Legacy per-store request fan-out must stay removed.');

console.log('Homepage leaflet metadata batch RPC OK');
