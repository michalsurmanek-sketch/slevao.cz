import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const admin = read('admin-viditelnost-letaku.html');
const adminJs = read('assets/admin-homepage-visibility.js');
const imageAdminJs = read('assets/admin-homepage-images.js');
const control = read('assets/home-leaflet-control.js');
const visibilityShim = read('assets/home-leaflet-visibility.js');
const loader = read('assets/home-all-stores.js');
const nav = read('assets/admin-homepage-image-nav.js');

for (const [name, source] of [
  ['admin-homepage-visibility.js', adminJs],
  ['admin-homepage-images.js', imageAdminJs],
  ['home-leaflet-control.js', control],
  ['home-leaflet-visibility.js', visibilityShim],
  ['home-all-stores.js', loader],
  ['admin-homepage-image-nav.js', nav],
]) new Script(source, { filename: name });

assert.match(admin, /admin-homepage-visibility\.js\?v=20260802-2/, 'Administrace nenačítá aktuální správu viditelnosti.');
assert.match(admin, /Karty s aktuálním letákem/, 'Administrace stále vydává všechny obchody za karty hlavní stránky.');
assert.match(adminJs, /Skrýt ze sekce/, 'Administrace neumí kartu skrýt.');
assert.match(adminJs, /Zobrazit v sekci/, 'Administrace neumí kartu znovu zobrazit.');
assert.match(adminJs, /META_KEY = 'slevao-leaflet-visibility'/, 'Administrace nepoužívá oddělený marker viditelnosti.');
assert.match(adminJs, /MAX_CARDS = 12/, 'Administrace nerespektuje maximální počet karet hlavní stránky.');
assert.match(adminJs, /activeOfferStoreIds/, 'Administrace neomezuje karty na obchody s platnými nabídkami.');
assert.match(adminJs, /store-leaflet-feed/, 'Administrace neověřuje skutečně dostupný aktuální leták.');
assert.match(adminJs, /currentLeaflet/, 'Administrace nekontroluje platnost letáku.');
assert.match(adminJs, /select\('id,name,slug,logo_url,website_url,is_active'\)[\s\S]*\.eq\('id', store\.id\)[\s\S]*\.single\(\)/, 'Viditelnost před uložením nenačítá čerstvou hodnotu obchodu.');
assert.match(adminJs, /\.update\(\{ \[field\]: nextValue \}\)/, 'Viditelnost se neukládá přímo k obchodu.');
assert.doesNotMatch(adminJs, /homepage-leaflet-visibility/, 'Administrace se nesmí vrátit k nefunkční Edge Function.');
assert.doesNotMatch(adminJs, /\.update\(\{\s*is_active/, 'Přepínač nesmí měnit obecnou viditelnost obchodu.');

assert.match(imageAdminJs, /data: fresh[\s\S]*markerField\(fresh\)[\s\S]*withMarker\(fresh\[field\], marker\)/, 'Obrázková administrace může přepsat novější nastavení viditelnosti.');

for (const pattern of [
  /VISIBILITY_KEY = 'slevao-leaflet-visibility'/,
  /settings\?\.visibility === 'hidden'/,
  /settings\?\.visibility === 'visible'/,
  /card\.hidden = hidden/,
  /style\.setProperty\('display', 'none', 'important'\)/,
  /legacyHidden/,
]) assert.match(control, pattern, `Společné řízení viditelnosti postrádá ${pattern}.`);

assert.match(visibilityShim, /home-leaflet-control\.js[\s\S]*Date\.now\(\)/, 'Loader viditelnosti nenačítá společné řízení bez cache.');
assert.match(loader, /home-leaflet-control\.js[\s\S]*Date\.now\(\)/, 'Hlavní loader nenačítá společné řízení bez cache.');
assert.match(nav, /admin-viditelnost-letaku\.html/, 'Administrace nemá odkaz na viditelnost letáků.');

console.log('Homepage leaflet visibility control OK');
