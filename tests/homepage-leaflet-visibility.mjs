import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const admin = read('admin-viditelnost-letaku.html');
const adminJs = read('assets/admin-homepage-visibility.js');
const control = read('assets/home-leaflet-control.js');
const visibilityShim = read('assets/home-leaflet-visibility.js');
const loader = read('assets/home-all-stores.js');
const nav = read('assets/admin-homepage-image-nav.js');

for (const [name, source] of [
  ['admin-homepage-visibility.js', adminJs],
  ['home-leaflet-control.js', control],
  ['home-leaflet-visibility.js', visibilityShim],
  ['admin-homepage-image-nav.js', nav],
]) new Script(source, { filename: name });

assert.match(admin, /admin-homepage-visibility\.js\?v=/, 'Administrace nenačítá přímou správu viditelnosti.');
assert.match(adminJs, /Skrýt ze sekce/, 'Administrace neumí kartu skrýt.');
assert.match(adminJs, /Zobrazit v sekci/, 'Administrace neumí kartu znovu zobrazit.');
assert.match(adminJs, /META_KEY = 'slevao-leaflet-visibility'/, 'Administrace nepoužívá oddělený marker viditelnosti.');
assert.match(adminJs, /db\.from\('stores'\)[\s\S]*\.update\(\{ \[field\]: nextValue \}\)/, 'Viditelnost se neukládá přímo k obchodu.');
assert.doesNotMatch(adminJs, /homepage-leaflet-visibility/, 'Administrace se nesmí vrátit k nefunkční Edge Function.');
assert.doesNotMatch(adminJs, /is_active\s*:/, 'Přepínač nesmí měnit obecnou viditelnost obchodu.');

for (const pattern of [
  /VISIBILITY_KEY = 'slevao-leaflet-visibility'/,
  /settings\?\.visibility === 'hidden'/,
  /settings\?\.visibility === 'visible'/,
  /card\.hidden = hidden/,
  /style\.setProperty\('display', 'none', 'important'\)/,
  /legacyHidden/,
]) assert.match(control, pattern, `Společné řízení viditelnosti postrádá ${pattern}.`);

assert.match(visibilityShim, /home-leaflet-control\.js[\s\S]*Date\.now\(\)/, 'Loader viditelnosti nenačítá společné řízení bez cache.');
assert.match(loader, /home-leaflet-visibility\.js[\s\S]*Date\.now\(\)/, 'Homepage nenačítá loader viditelnosti bez cache.');
assert.match(nav, /admin-viditelnost-letaku\.html/, 'Administrace nemá odkaz na viditelnost letáků.');

console.log('Homepage leaflet visibility control OK');
