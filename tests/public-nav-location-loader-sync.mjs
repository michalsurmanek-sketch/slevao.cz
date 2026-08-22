import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const nav = readFileSync(new URL('assets/public-nav-upgrade.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');
const product = readFileSync(new URL('produkt.html', root), 'utf8');
const list = readFileSync(new URL('seznam.html', root), 'utf8');
const account = readFileSync(new URL('ucet.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(nav, { filename:'assets/public-nav-upgrade.js' });

const navVersion = '20260822-1';
const locationVersion = '20260821-1';

assert.match(nav, /function loadLocationService\(\)/, 'Public nav negarantuje načtení location service.');
assert.match(nav, new RegExp(`assets/location-service\\.js\\?v=${locationVersion}`), 'Public nav nenačítá Prague-safe location runtime.');
assert.ok(
  nav.indexOf('loadLocationService();') < nav.indexOf('loadStoreArrivalAlerts();'),
  'Location service se musí spustit před store-arrival runtime.'
);

for (const [name, source] of [['index.html', index], ['produkt.html', product], ['seznam.html', list], ['ucet.html', account]]) {
  assert.match(source, new RegExp(`assets/public-nav-upgrade\\.js\\?v=${navVersion}`), `${name} nepoužívá aktuální public-nav verzi.`);
}

assert.ok(
  index.indexOf(`assets/public-nav-upgrade.js?v=${navVersion}`) < index.indexOf('assets/home-footer-redesign.js'),
  'Homepage musí načíst public nav před footer runtime, aby nevznikla stará dynamická kopie.'
);
assert.match(worker, new RegExp(`assets/public-nav-upgrade\\.js\\?v=${navVersion}`), 'PWA shell nemá aktuální public-nav verzi.');
assert.match(worker, new RegExp(`assets/location-service\\.js\\?v=${locationVersion}`), 'PWA shell nemá Prague-safe location-service verzi.');

console.log('Public nav/location loader sync OK');
