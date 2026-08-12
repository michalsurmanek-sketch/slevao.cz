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

assert.match(admin, /admin-homepage-visibility\.js\?v=/, 'Administrace nenačítá správu viditelnosti.');
assert.match(adminJs, /VISIBILITY_KEY = 'slevao-leaflet-visibility'/, 'Administrace nepoužívá marker viditelnosti.');
assert.match(adminJs, /FORCE_KEY = 'slevao-leaflet-force'/, 'Administrace nemá marker ručně přidané karty.');
assert.match(adminJs, /Přidat další obchod/, 'Administrace nemá výběr dalšího obchodu.');
assert.match(adminJs, /Přidat do sekce/, 'Administrace nemá tlačítko pro přidání obchodu.');
assert.match(adminJs, /Odebrat vlastní kartu/, 'Administrace neumí ruční kartu odebrat.');
assert.match(adminJs, /MAX_AUTO_CARDS = 12/, 'Administrace nerespektuje maximální počet automatických karet.');
assert.match(adminJs, /activeOfferStoreIds/, 'Administrace neomezuje automatické karty na obchody s platnými nabídkami.');
assert.match(adminJs, /store-leaflet-feed/, 'Administrace neověřuje dostupný aktuální leták.');
assert.match(adminJs, /\[FORCE_KEY\]: '1'/, 'Přidání obchodu neukládá ruční zařazení.');
assert.match(adminJs, /\[VISIBILITY_KEY\]: 'visible'/, 'Přidaný obchod se nezapíná jako viditelný.');
assert.match(adminJs, /readFreshStore|select\('id,name,slug,logo_url,website_url,is_active'\)/, 'Nastavení před uložením nenačítá čerstvou hodnotu obchodu.');
assert.match(adminJs, /\.update\(\{ \[field\]: nextValue \}\)/, 'Nastavení se neukládá přímo k obchodu.');
assert.doesNotMatch(adminJs, /homepage-leaflet-visibility/, 'Administrace se nesmí vrátit k nefunkční Edge Function.');
assert.doesNotMatch(adminJs, /\.update\(\{\s*is_active/, 'Přepínač nesmí měnit obecnou viditelnost obchodu.');

assert.match(imageAdminJs, /data: fresh[\s\S]*markerField\(fresh\)[\s\S]*withMarker\(fresh\[field\], marker\)/, 'Obrázková administrace může přepsat novější nastavení viditelnosti.');

for (const pattern of [
  /VISIBILITY_KEY = 'slevao-leaflet-visibility'/,
  /FORCE_KEY = 'slevao-leaflet-force'/,
  /settings\?\.visibility === 'hidden'/,
  /card\.hidden = hidden/,
  /style\.setProperty\('display', 'none', 'important'\)/,
  /forcedCardMarkup/,
  /data-forced-leaflet-card/,
  /Aktuální nabídky/,
]) assert.match(control, pattern, `Řízení hlavní sekce postrádá ${pattern}.`);

assert.match(visibilityShim, /home-leaflet-control\.js\?v=[a-z0-9-]+/i, 'Loader viditelnosti nenačítá verzované společné řízení.');
assert.match(loader, /home-leaflet-control\.js\?v=[a-z0-9-]+/i, 'Hlavní loader nenačítá verzované společné řízení.');
assert.match(nav, /admin-viditelnost-letaku\.html/, 'Administrace nemá odkaz na viditelnost letáků.');

console.log('Homepage leaflet visibility and manual store control OK');