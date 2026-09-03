import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-owner-item-concurrency.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-owner-item-concurrency.js' });

const runtimeUrl = 'assets/shopping-owner-item-concurrency.js?v=20260828-1';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
const publicNavUrl = html.match(/assets\/public-nav-upgrade\.js\?v=[^"']+/)?.[0] || '';
assert.ok(html.includes(runtimeUrl), 'seznam.html nenačítá owner item semantic CAS bridge.');
assert.match(publicNavUrl, /^assets\/public-nav-upgrade\.js\?v=\d{8}-\d+$/, 'seznam.html nemá verzovaný owner-scoped localStorage bridge.');
assert.ok(
  html.indexOf(publicNavUrl) < html.indexOf(runtimeUrl),
  'Owner item CAS bridge běží před owner-scoped localStorage bridge.'
);
const bootstrapMatch = bootstrapUrl.match(/\?v=(\d{8})-(\d+)$/);
assert.ok(bootstrapMatch, 'seznam.html nemá platnou YYYYMMDD-revision verzi shopping bootstrapu.');
const bootstrapDate = Number(bootstrapMatch[1]);
const bootstrapRevision = Number(bootstrapMatch[2]);
assert.ok(
  bootstrapDate > 20260828 || (bootstrapDate === 20260828 && bootstrapRevision >= 7),
  'seznam.html má bootstrap starší než guest-product fallback integrace v7.'
);
assert.ok(
  html.indexOf(runtimeUrl) < html.indexOf(bootstrapUrl),
  'Owner item CAS bridge musí obalit Supabase klienta před shopping runtime bootstrapem.'
);
assert.match(worker, /url\.pathname\.startsWith\('\/assets\/'\)/, 'PWA runtime neobsluhuje owner item CAS bridge a bootstrap.');
assert.match(worker, /const freshRequest = new Request\(request, \{ cache: 'reload' \}\)/, 'Owner item CAS bridge není v PWA network-first runtime vrstvě.');
assert.match(worker, /await cache\.put\(request, response\.clone\(\)\)/, 'PWA neukládá přesnou verzovanou owner item CAS URL.');
const cacheMatch = worker.match(/const CACHE_VERSION = '(\d{8})-(\d+)';/);
assert.ok(cacheMatch, 'PWA cache nemá očekávaný verzovaný formát YYYYMMDD-revision.');
const cacheDate = Number(cacheMatch[1]);
const cacheRevision = Number(cacheMatch[2]);
assert.ok(
  cacheDate > 20260828 || (cacheDate === 20260828 && cacheRevision >= 60),
  'PWA cache se nesmí vrátit pod owner item CAS baseline 20260828-60.',
);
assert.ok(source.includes("if (sharedMode || !document.querySelector('.sfListLayout')) return;"), 'CAS bridge není bezpečně vypnutý ve shared režimu.');
assert.ok(source.includes("if (String(table) !== 'shopping_list_items') return base;"), 'CAS bridge neomezuje Supabase proxy jen na shopping_list_items.');

console.log('Shopping owner item semantic CAS integration OK');
