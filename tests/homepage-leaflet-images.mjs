import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const admin = read('admin-obrazky-letaku.html');
const adminJs = read('assets/admin-homepage-images.js');
const control = read('assets/home-leaflet-control.js');
const manualShim = read('assets/home-manual-leaflet-images.js');
const visibilityShim = read('assets/home-leaflet-visibility.js');
const allStores = read('assets/home-all-stores.js');
const kaufland = read('assets/home-kaufland-food-cover.js');

for (const [name, source] of [
  ['admin-homepage-images.js', adminJs],
  ['home-leaflet-control.js', control],
  ['home-manual-leaflet-images.js', manualShim],
  ['home-leaflet-visibility.js', visibilityShim],
  ['home-all-stores.js', allStores],
]) new Script(source, { filename: name });

assert.match(admin, /admin-homepage-images\.js\?v=/, 'Administrace nenačítá správce obrázků.');
assert.match(admin, /image\/jpeg,image\/png,image\/webp,image\/avif/, 'Výběr nepovoluje podporované formáty.');
assert.match(adminJs, /uniquePath\(/, 'Každý obrázek nemá unikátní cestu.');
assert.match(adminJs, /crypto\.randomUUID|Date\.now\(\)/, 'Unikátní cesta nemá bezpečnou verzi.');
assert.doesNotMatch(adminJs, /homepage\/\$\{store\.slug\}\/cover\./, 'Obrázky se nesmí přepisovat pod pevnou adresou cover.');
assert.match(adminJs, /persistMarker/, 'Nahraná adresa se nepřipíná k obchodu.');

for (const pattern of [
  /COVER_KEY = 'slevao-cover'/,
  /VISIBILITY_KEY = 'slevao-leaflet-visibility'/,
  /desiredImage/,
  /manualLeafletCover/,
  /Vlastní obrázek/,
  /Ukázková fotografie/,
]) assert.match(control, pattern, `Společné řízení karet postrádá ${pattern}.`);
assert.doesNotMatch(control, /function legacyImageUrl|storage\/v1\/object\/public\/homepage-leaflet-images/, 'Společné řízení nesmí obnovit staré plošné dotazy do bucketu.');

assert.match(manualShim, /home-leaflet-control\.js\?v=[a-z0-9-]+/i, 'Obrázkový loader nenačítá aktuální společné řízení.');
assert.match(visibilityShim, /home-leaflet-control\.js\?v=[a-z0-9-]+/i, 'Loader viditelnosti nenačítá aktuální společné řízení.');
assert.match(allStores, /home-leaflet-control\.js\?v=[a-z0-9-]+/i, 'Hlavní loader nenačítá verzované společné řízení.');
assert.match(kaufland, /manualLeafletCover === '1'/, 'Kaufland může přepsat vlastní obrázek.');

console.log('Homepage leaflet image control OK');
