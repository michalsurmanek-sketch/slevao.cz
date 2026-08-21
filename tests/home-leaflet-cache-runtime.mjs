import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('assets/home-leaflet-covers.js', 'utf8');

const startBlock = source.match(/function start\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
assert(startBlock, 'Leaflet renderer start() must exist.');
assert(!startBlock.includes('loadPdfjs'), 'Homepage startup must not preload PDF.js.');
assert(source.includes('const pdfjs = await loadPdfjs();'), 'PDF.js must remain lazy-loaded when an actual PDF needs rendering.');
assert(source.includes('function scheduleFreshCacheRefresh(cachedMeta)'), 'Fresh leaflet metadata must use an expiry-based refresh scheduler.');
assert(source.includes('META_CACHE_TTL - Math.max(0, Date.now() - savedAt)'), 'Refresh delay must be based on the remaining cache TTL.');
assert(!source.includes('if (cacheFresh) {\n        window.setTimeout(async () =>'), 'Fresh cache must not trigger the legacy immediate background network validation.');
assert(source.includes("document.addEventListener('visibilitychange'"), 'Returning to a visible tab must re-check leaflet cache freshness.');
assert(source.includes('Date.now() - savedAt >= META_CACHE_TTL'), 'Visibility refresh must only force the network after cache expiry.');
assert(source.includes('window.clearTimeout(cacheRefreshTimer);'), 'Scheduled cache refresh must be cleaned up.');

console.log('Homepage leaflet cache runtime OK');
