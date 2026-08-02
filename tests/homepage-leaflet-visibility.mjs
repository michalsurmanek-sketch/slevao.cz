import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const admin = read('admin-viditelnost-letaku.html');
const homepage = read('assets/home-leaflet-visibility.js');
const loader = read('assets/home-all-stores.js');
const nav = read('assets/admin-homepage-image-nav.js');
const edge = read('supabase/functions/homepage-leaflet-visibility/index.ts');
const config = read('supabase/functions/homepage-leaflet-visibility/config.toml');
const deploy = read('.github/workflows/deploy-edge-functions.yml');

new Script(homepage, { filename: 'assets/home-leaflet-visibility.js' });
new Script(nav, { filename: 'assets/admin-homepage-image-nav.js' });
const inline = admin.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/)?.[1];
assert.ok(inline, 'Administrace viditelnosti nemá hlavní JavaScript.');
new Script(inline, { filename: 'admin-viditelnost-letaku.html:inline' });

assert.match(admin, /Skrýt z hlavní sekce/, 'Administrace neumí obchod skrýt.');
assert.match(admin, /Zobrazit v hlavní sekci/, 'Administrace neumí obchod znovu zobrazit.');
assert.match(admin, /Toto nastavení ovlivní pouze sekci/, 'Administrace nevysvětluje oddělení od obecné viditelnosti obchodu.');
assert.match(admin, /action:'set'[\s\S]*store_slug[\s\S]*visible/, 'Přepínač neukládá viditelnost obchodu.');
assert.doesNotMatch(admin, /from\('stores'\)\.update|from\("stores"\)\.update/, 'Přepínač nesmí měnit is_active obchodu.');

assert.match(loader, /home-leaflet-visibility\.js[\s\S]*Date\.now\(\)/, 'Homepage nenačítá pravidla viditelnosti bez cache.');
assert.match(homepage, /homepage-leaflet-settings\/visibility\.json/, 'Homepage nečte veřejné nastavení.');
assert.match(homepage, /card\.hidden\s*=\s*isHidden/, 'Homepage neschovává vybrané karty.');
assert.match(homepage, /setInterval\([^\n]*refresh|setInterval\(\(\) => refresh/, 'Homepage pravidelně neobnovuje nastavení.');
assert.match(nav, /admin-viditelnost-letaku\.html/, 'Hlavní administrace nemá odkaz na viditelnost letáků.');

for (const pattern of [
  /ALLOWED_ROLES[\s\S]*admin[\s\S]*editor/,
  /db\.auth\.getUser\(token\)/,
  /db\.from\("stores"\)/,
  /homepage-leaflet-settings/,
  /visibility\.json/,
  /public: true/,
  /allowedMimeTypes: \["application\/json"\]/,
  /action === "get"/,
  /action !== "set"/,
  /upsert: true/,
]) assert.match(edge, pattern, `Edge Function postrádá ochranu ${pattern}.`);

assert.match(config, /verify_jwt\s*=\s*false/, 'Funkce musí ověřovat přihlášení uvnitř kódu.');
assert.match(deploy, /functions deploy homepage-leaflet-visibility[\s\S]*--no-verify-jwt/, 'Funkce viditelnosti se nenasazuje samostatně.');

console.log('Homepage leaflet visibility OK');
