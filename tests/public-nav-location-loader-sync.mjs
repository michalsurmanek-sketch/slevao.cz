import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const nav = readFileSync(new URL('assets/public-nav-upgrade.js', root), 'utf8');
const footer = readFileSync(new URL('assets/home-footer-redesign.js', root), 'utf8');
const storeBottomNav = readFileSync(new URL('assets/store-bottom-nav.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');
const product = readFileSync(new URL('produkt.html', root), 'utf8');
const list = readFileSync(new URL('seznam.html', root), 'utf8');
const account = readFileSync(new URL('ucet.html', root), 'utf8');
const lidl = readFileSync(new URL('lidl.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(nav, { filename:'assets/public-nav-upgrade.js' });

const navVersion = '20260904-1';
const storeBottomNavVersion = '20260901-1';
const locationVersion = '20260821-1';
const publicFeaturesVersion = '20260828-2';

assert.match(nav, /function loadLocationService\(\)/, 'Public nav negarantuje načtení location service.');
assert.match(nav, new RegExp(`assets/location-service\\.js\\?v=${locationVersion}`), 'Public nav nenačítá Prague-safe location runtime.');
assert.ok(
  nav.indexOf('loadLocationService();') < nav.indexOf('loadStoreArrivalAlerts();'),
  'Location service se musí spustit před store-arrival runtime.'
);

for (const [name, source] of [['index.html', index], ['produkt.html', product], ['seznam.html', list], ['ucet.html', account]]) {
  assert.match(source, new RegExp(`assets/public-nav-upgrade\\.js\\?v=${navVersion}`), `${name} nepoužívá aktuální public-nav verzi.`);
}

for (const [name, source] of [['index.html', index], ['produkt.html', product], ['seznam.html', list], ['ucet.html', account]]) {
  assert.match(source, new RegExp(`assets/public-features\\.js\\?v=${publicFeaturesVersion}`), `${name} nepoužívá sjednocenou public-features verzi.`);
}
assert.match(footer, new RegExp(`assets/public-features\\.js\\?v=${publicFeaturesVersion}`), 'Homepage footer loader nepoužívá sjednocenou public-features verzi.');
assert.match(footer, new RegExp(`assets/public-nav-upgrade\\.js\\?v=${navVersion}`), 'Homepage fallback loader nepoužívá aktuální public-nav verzi.');
assert.match(storeBottomNav, new RegExp(`assets/public-nav-upgrade\\.js\\?v=${navVersion}`), 'Store bottom-nav loader nepoužívá aktuální public-nav verzi.');
assert.match(lidl, new RegExp(`assets/store-bottom-nav\\.js\\?v=${storeBottomNavVersion}`), 'Lidl stránka nepoužívá aktuální store-bottom-nav cache verzi.');

assert.ok(
  index.indexOf(`assets/public-nav-upgrade.js?v=${navVersion}`) < index.indexOf('assets/home-footer-redesign.js'),
  'Homepage musí načíst public nav před footer runtime, aby nevznikla stará dynamická kopie.'
);

// Public assets no longer belong to install-time precache. The worker must cache
// the exact versioned request after a successful use instead.
assert.match(worker, /function isLocalStatic\(request, url\)/, 'PWA nemá obecný runtime guard lokálních assetů.');
assert.match(worker, /url\.pathname\.startsWith\('\/assets\/'\)/, 'PWA runtime neobsluhuje /assets/ soubory.');
assert.match(worker, /function isCriticalStatic\(url\)/, 'PWA nerozlišuje kritické CSS\/JS assety.');
assert.match(worker, /const freshRequest = new Request\(request, \{ cache: 'reload' \}\)/, 'PWA kritické assety nejsou network-first.');
assert.match(worker, /await cache\.put\(request, response\.clone\(\)\)/, 'PWA neukládá přesnou verzovanou URL do runtime cache.');
assert.doesNotMatch(worker, /assets\/public-features\.js\?v=20260811-3/, 'PWA nesmí držet starý public-features alias.');

console.log('Public nav/location/features loader sync OK');
