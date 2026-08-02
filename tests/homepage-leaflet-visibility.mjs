import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const admin = read('admin-viditelnost-letaku.html');
const adminJs = read('assets/admin-homepage-visibility.js');
const homepage = read('assets/home-leaflet-visibility.js');
const loader = read('assets/home-all-stores.js');
const nav = read('assets/admin-homepage-image-nav.js');
const edge = read('supabase/functions/homepage-leaflet-visibility/index.ts');
const config = read('supabase/functions/homepage-leaflet-visibility/config.toml');
const deploy = read('.github/workflows/deploy-edge-functions.yml');

new Script(adminJs, { filename: 'assets/admin-homepage-visibility.js' });
new Script(homepage, { filename: 'assets/home-leaflet-visibility.js' });
new Script(nav, { filename: 'assets/admin-homepage-image-nav.js' });

assert.match(admin, /admin-homepage-visibility\.js\?v=/, 'Administrace nenačítá přímou správu viditelnosti.');
assert.match(admin, /Toto nastavení ovlivní pouze sekci/, 'Administrace nevysvětluje oddělení od obecné viditelnosti obchodu.');
assert.match(adminJs, /Skrýt ze sekce/, 'Administrace neumí obchod skrýt.');
assert.match(adminJs, /Zobrazit v sekci/, 'Administrace neumí obchod znovu zobrazit.');
assert.match(adminJs, /db\.from\('stores'\)[\s\S]*\.update\(\{ \[field\]: nextValue \}\)/, 'Přepínač neukládá nastavení přímo k obchodu.');
assert.match(adminJs, /META_KEY = 'slevao-leaflet-visibility'/, 'Přepínač nemá oddělený marker viditelnosti letáků.');
assert.match(adminJs, /website_url,logo_url,is_active/, 'Administrace nenačítá údaje potřebné pro přímé nastavení.');
assert.match(adminJs, /readLegacySettings/, 'Administrace nezachovává staré nastavení jako zálohu.');
assert.doesNotMatch(adminJs, /functions\/v1\/homepage-leaflet-visibility/, 'Administrace se nesmí vrátit k nefunkční Edge Function.');
assert.doesNotMatch(adminJs, /update\(\{\s*is_active/, 'Přepínač nesmí měnit obecnou viditelnost obchodu.');
assert.doesNotMatch(adminJs, /Failed to fetch/, 'Administrace nesmí vracet obecnou chybu Failed to fetch.');

assert.match(loader, /home-leaflet-visibility\.js[\s\S]*Date\.now\(\)/, 'Homepage nenačítá pravidla viditelnosti bez cache.');
assert.match(homepage, /homepage-leaflet-settings\/visibility\.json/, 'Homepage nezachovává staré veřejné nastavení.');
assert.match(homepage, /rest\/v1\/stores/, 'Homepage nečte přímé nastavení obchodů.');
assert.match(homepage, /META_KEY = 'slevao-leaflet-visibility'/, 'Homepage nerozpoznává nový marker viditelnosti.');
assert.match(homepage, /marker === 'hidden'[\s\S]*marker === 'visible'/, 'Homepage neumí přímé skrytí i obnovení přepsat.');
assert.match(homepage, /card\.hidden\s*=\s*isHidden/, 'Homepage neschovává vybrané karty.');
assert.match(homepage, /setInterval\([^\n]*refresh|setInterval\(\(\) => refresh/, 'Homepage pravidelně neobnovuje nastavení.');
assert.match(homepage, /slevao-leaflet-visibility-changed/, 'Homepage nereaguje na změnu z administrační karty.');
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
]) assert.match(edge, pattern, `Záložní Edge Function postrádá ochranu ${pattern}.`);

assert.match(config, /verify_jwt\s*=\s*false/, 'Záložní funkce musí ověřovat přihlášení uvnitř kódu.');
assert.match(deploy, /functions deploy homepage-leaflet-visibility[\s\S]*--no-verify-jwt/, 'Záložní funkce viditelnosti se nenasazuje samostatně.');

console.log('Homepage leaflet visibility direct management OK');
