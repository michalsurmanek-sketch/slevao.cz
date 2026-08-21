import assert from 'node:assert/strict';
import fs from 'node:fs';

const covers = fs.readFileSync('assets/home-leaflet-covers.js', 'utf8');
const control = fs.readFileSync('assets/home-leaflet-control.js', 'utf8');

for (const [name, source] of [['covers', covers], ['control', control]]) {
  assert(source.includes('window.__slevaoLoadLeafletStoreRows'), `${name} must use the shared leaflet store loader.`);
  assert(source.includes('if (pending) return pending;'), `${name} must reuse the shared in-flight store request.`);
  assert(source.includes('if (!refresh && rows.length) return rows;'), `${name} must reuse cached store rows when a refresh is not forced.`);
  assert(source.includes("select: 'id,slug,name,logo_url,website_url,is_active'"), `${name} must use the same store metadata projection.`);
  assert(source.includes("order: 'name.asc'"), `${name} must use the same stable store ordering.`);
}

assert(covers.includes('const stores = await loadLeafletStoreRows(false);'), 'Leaflet covers must consume shared store rows without forcing another request.');
assert(control.includes('const rows = await fetchStores(force);'), 'Leaflet control must pass its refresh flag into the shared store loader.');
assert(control.includes('return loadLeafletStoreRows(force);'), 'Leaflet control fetchStores must delegate to the shared loader.');
assert(covers.includes('Promise.all([activeStores(), currentLeaflets()])'), 'Shared stores and public leaflet RPC must remain parallelized.');

console.log('Homepage leaflet shared store loader OK');
