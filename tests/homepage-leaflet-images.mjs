import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const admin = read('admin-obrazky-letaku.html');
const adminJs = read('assets/admin-homepage-images.js');
const manual = read('assets/home-manual-leaflet-images.js');
const allStores = read('assets/home-all-stores.js');
const nav = read('assets/admin-homepage-image-nav.js');
const loader = read('assets/admin-store-delete.js');
const kaufland = read('assets/home-kaufland-food-cover.js');
const edge = read('supabase/functions/homepage-leaflet-image/index.ts');
const config = read('supabase/functions/homepage-leaflet-image/config.toml');
const deploy = read('.github/workflows/deploy-edge-functions.yml');

new Script(adminJs, { filename: 'assets/admin-homepage-images.js' });
new Script(manual, { filename: 'assets/home-manual-leaflet-images.js' });
new Script(allStores, { filename: 'assets/home-all-stores.js' });
new Script(nav, { filename: 'assets/admin-homepage-image-nav.js' });

assert.match(admin, /admin-homepage-images\.js\?v=/, 'Administrace nenačítá nový správce obrázků.');
assert.match(admin, /image\/jpeg,image\/png,image\/webp,image\/avif/, 'Výběr souboru nepovoluje podporované formáty.');
assert.match(admin, /id="upload"[\s\S]*Nahrát a použít na webu/, 'Administrace nemá tlačítko nahrání.');
assert.match(admin, /id="remove"[\s\S]*Odstranit vlastní obrázek/, 'Administrace nemá tlačítko odstranění.');

for (const pattern of [
  /MAX_BYTES = 8 \* 1024 \* 1024/,
  /ALLOWED_TYPES/,
  /uploadDirect/,
  /uploadDedicated/,
  /uploadThroughExistingService/,
  /upload-product-image/,
  /persistMarker/,
  /website_url/,
  /logo_url/,
  /COVER_META_KEY = 'slevao-cover'/,
  /marker === 'none'/,
]) assert.match(adminJs, pattern, `Správce obrázků postrádá ochranu nebo zálohu ${pattern}.`);

assert.doesNotMatch(adminJs, /catch\s*\([^)]*\)\s*\{\s*show\(['"]Failed to fetch/, 'Administrace nesmí uživateli vracet obecnou chybu Failed to fetch.');
assert.match(loader, /admin-homepage-image-nav\.js[\s\S]*Date\.now\(\)/, 'Hlavní administrace nenačítá odkaz na správu obrázků.');
assert.match(nav, /admin-obrazky-letaku\.html/, 'Navigace neobsahuje správu obrázků letáků.');

for (const pattern of [
  /select: 'slug,website_url,logo_url'/,
  /COVER_META_KEY = 'slevao-cover'/,
  /mappedCovers/,
  /explicitlyDisabled/,
  /homepage-leaflet-images/,
  /manualLeafletCover/,
  /Vlastní obrázek/,
]) assert.match(manual, pattern, `Homepage postrádá načítání vlastních obrázků ${pattern}.`);

assert.match(allStores, /home-manual-leaflet-images\.js[\s\S]*Date\.now\(\)/, 'Seznam obchodů nevynucuje aktuální správu ručních obrázků.');
assert.match(kaufland, /manualLeafletCover === '1'/, 'Kaufland může přepsat ručně vložený obrázek.');
assert.match(kaufland, /home-manual-leaflet-images\.js[\s\S]*Date\.now\(\)/, 'Homepage nenačítá aktuální správu ručních obrázků.');

for (const pattern of [
  /ALLOWED_ROLES[\s\S]*admin[\s\S]*editor/,
  /db\.auth\.getUser\(token\)/,
  /db\.from\("stores"\)/,
  /MAX_BYTES = 8 \* 1024 \* 1024/,
  /detectedType/,
  /public: true/,
  /upsert: true/,
  /action === "delete"/,
]) assert.match(edge, pattern, `Edge Function postrádá ochranu ${pattern}.`);

assert.match(config, /verify_jwt\s*=\s*false/, 'Funkce musí ověřovat přihlášení uvnitř kódu.');
assert.match(deploy, /deploy-homepage-leaflet-image[\s\S]*functions deploy homepage-leaflet-image[\s\S]*--no-verify-jwt/, 'Správce obrázků nemá samostatné nasazení.');

console.log('Homepage leaflet image management and fallbacks OK');
