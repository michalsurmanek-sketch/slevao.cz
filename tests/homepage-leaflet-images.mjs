import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const admin = read('admin-obrazky-letaku.html');
const manual = read('assets/home-manual-leaflet-images.js');
const nav = read('assets/admin-homepage-image-nav.js');
const loader = read('assets/admin-store-delete.js');
const kaufland = read('assets/home-kaufland-food-cover.js');
const edge = read('supabase/functions/homepage-leaflet-image/index.ts');
const config = read('supabase/functions/homepage-leaflet-image/config.toml');
const deploy = read('.github/workflows/deploy-edge-functions.yml');

new Script(manual, { filename: 'assets/home-manual-leaflet-images.js' });
new Script(nav, { filename: 'assets/admin-homepage-image-nav.js' });
const inline = admin.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/)?.[1];
assert.ok(inline, 'Administrační stránka nemá hlavní JavaScript.');
new Script(inline, { filename: 'admin-obrazky-letaku.html:inline' });

assert.match(admin, /homepage-leaflet-image/, 'Administrace nevolá správce obrázků.');
assert.match(admin, /image\/jpeg[^\n]*image\/png[^\n]*image\/webp[^\n]*image\/avif/, 'Administrace nekontroluje podporované formáty.');
assert.match(admin, /8\*1024\*1024/, 'Administrace nemá limit 8 MB.');
assert.match(loader, /admin-homepage-image-nav\.js[\s\S]*Date\.now\(\)/, 'Hlavní administrace nenačítá odkaz na správu obrázků.');
assert.match(nav, /admin-obrazky-letaku\.html/, 'Navigace neobsahuje správu obrázků letáků.');
assert.match(manual, /homepage-leaflet-images/, 'Homepage nepoužívá veřejné úložiště vlastních obrázků.');
assert.match(manual, /manualLeafletCover/, 'Karta není označena jako ručně přepsaná.');
assert.match(manual, /Vlastní obrázek/, 'Karta neoznačuje ruční fotografii.');
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
assert.match(deploy, /functions deploy homepage-leaflet-image[\s\S]*--no-verify-jwt/, 'Správce obrázků se nenasazuje samostatně.');

console.log('Homepage leaflet image management OK');
