import assert from 'node:assert/strict';
import fs from 'node:fs';

const stores = fs.readFileSync('assets/home-all-stores.js', 'utf8');
const overview = fs.readFileSync('assets/home-overview.js', 'utf8');

assert(stores.includes('function publishStoreDirectory()'), 'All-stores layer must publish its already loaded directory.');
assert(stores.includes('window.__slevaoStoreDirectory = directory;'), 'Shared store directory must be cached for late overview initialization.');
assert(stores.includes("new CustomEvent('slevao:store-directory'"), 'Store refreshes must notify the overview layer.');
assert(stores.includes('publishStoreDirectory();'), 'Successful store loads must publish the shared directory.');
assert(overview.includes('window.__slevaoStoreDirectory'), 'Overview must reuse the shared store directory cache.');
assert(overview.includes("document.addEventListener('slevao:store-directory'"), 'Overview must react to refreshed shared store data.');
assert(overview.includes('function applyStoreDirectory(rows)'), 'Overview must preserve its own store ordering/rendering boundary.');
assert(!overview.includes("/rest/v1/stores?"), 'Overview must not duplicate the store directory REST request.');
assert(!overview.includes("select: 'name,slug,logo_url,is_active'"), 'Legacy duplicate stores query must stay removed.');
assert(overview.includes('else syncStores();'), 'Overview must retain the storeGrid fallback before the shared directory arrives.');

console.log('Homepage shared store directory OK');
