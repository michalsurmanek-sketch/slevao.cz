import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('assets/home-overview.js', 'utf8');

assert(source.includes('const DATA_REFRESH_MS = 5 * 60 * 1000;'), 'Overview data refresh cadence must stay explicit.');
assert(source.includes('async function refreshOverviewData()'), 'Overview data loads must share one refresh entry point.');
assert(source.includes('if (document.hidden) return;'), 'Overview refresh must skip hidden tabs.');
assert(source.includes('Promise.allSettled([loadEnding(), loadOverviewStores()])'), 'Ending offers and stores must refresh together.');
assert(!source.includes('window.setInterval(loadEnding, 300000)'), 'Ending offers must not poll independently in hidden tabs.');
assert(!source.includes('window.setInterval(loadOverviewStores, 300000)'), 'Store overview must not poll independently in hidden tabs.');
assert(source.includes('Date.now() - lastOverviewRefreshAt >= DATA_REFRESH_MS'), 'Returning to a visible tab must refresh only stale overview data.');
assert(source.includes('if (!document.hidden) refreshOverviewData();'), 'Periodic refresh must remain visibility-aware.');

console.log('Homepage overview hidden polling OK');
