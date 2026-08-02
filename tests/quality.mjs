import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const exists = (path) => existsSync(new URL(path, root));

const requiredFiles = [
  'index.html', 'assets/home-v2.css', 'assets/home-v2.js',
  'admin.html', 'admin-automatizace.html', 'admin-tesco-kontrola.html',
  'robots.txt', 'sitemap.xml', 'favicon.svg',
  'assets/store-feed.css', 'assets/store-feed.js',
  'assets/search-suggest.css', 'assets/search-suggest.js',
];
for (const path of requiredFiles) assert(exists(path), `Chybí povinný soubor: ${path}`);

const expectedWorkflows = [
  'automatic-leaflets.yml',
  'deploy-edge-functions.yml',
  'deploy-official-leaflet-resolver.yml',
  'deploy-publish-imports.yml',
  'discover-product-images.yml',
  'match-product-catalog.yml',
  'quality.yml',
];
const workflows = readdirSync(new URL('.github/workflows/', root)).filter((path) => path.endsWith('.yml')).sort();
assert.deepEqual(workflows, expectedWorkflows, 'Repozitář obsahuje zastaralé nebo chybějící GitHub workflow.');
for (const path of workflows) {
  const source = read(`.github/workflows/${path}`);
  assert(!/permissions:\s*[\s\S]{0,100}contents:\s*write/.test(source), `${path} nesmí automaticky přepisovat zdrojový kód.`);
}

const index = read('index.html');
const homeJs = read('assets/home-v2.js');
const homeCss = read('assets/home-v2.css');
const searchSuggest = read('assets/search-suggest.js');
new Script(homeJs, { filename:'assets/home-v2.js' });
new Script(searchSuggest, { filename:'assets/search-suggest.js' });

assert.match(index, /<link rel="canonical" href="https:\/\/slevao\.cz\/">/, 'Homepage nemá canonical URL.');
assert.match(index, /application\/ld\+json/, 'Homepage nemá strukturovaná data.');
assert.match(index, /<meta property="og:title"/, 'Homepage nemá Open Graph metadata.');
assert.match(index, /assets\/home-v2\.css\?v=20260802-2/, 'Homepage nenačítá statické styly v2.');
assert.match(index, /assets\/home-v2\.js\?v=20260802-2/, 'Homepage nenačítá statický JavaScript v2.');
assert.doesNotMatch(index + homeJs + searchSuggest, /DecompressionStream|\.home-v2-parts/, 'Homepage nesmí používat dynamický komprimovaný zavaděč.');
assert.doesNotMatch(index, /cdn\.jsdelivr\.net\/npm\/@supabase/, 'Homepage nesmí záviset na externím Supabase SDK.');

for (const id of ['categoriesSection','storesSection','leafletsSection','dealsSection','quickTabs','filterPanel','mobileSaved','compareModal','reportModal']) {
  assert(index.includes(`id="${id}"`), `Homepage postrádá prvek ${id}.`);
}
for (const text of ['Nakupuj podle kategorie','Letáky a nabídky obchodů','Největší slevy','Končí dnes','Nově přidané','Do 50 Kč','Do 100 Kč']) {
  assert(index.includes(text), `Homepage postrádá sekci nebo filtr: ${text}`);
}
assert.match(homeCss, /\.mobileNav/, 'Homepage nemá mobilní spodní navigaci.');
assert.match(homeCss, /@media\(max-width:800px\)/, 'Homepage nemá responzivní mobilní pravidla.');

assert.match(homeJs, /async function fetchOffers\(/, 'Katalog musí stránkovaně načítat nabídky.');
assert.match(homeJs, /for \(let from = 0; ; from \+= 1000\)/, 'Načítání musí podporovat více než 1000 nabídek.');
assert.match(homeJs, /function deduplicate\(/, 'Katalog musí odstraňovat duplicity.');
assert.match(homeJs, /AbortController/, 'Databázové načítání musí mít časový limit.');
assert.match(homeJs, /CACHE_KEY/, 'Homepage musí mít záložní cache posledních funkčních dat.');
assert.match(homeJs, /return collect\(simpleSelect\)/, 'Homepage musí mít náhradní databázový dotaz.');
assert.match(homeJs, /location\.reload\(\)/, 'Chyba načítání musí nabídnout ruční opakování.');
assert.match(homeJs, /function categoryOf\(/, 'Homepage musí umět kategorizovat nabídky.');
assert.match(homeJs, /function geographyMatches\(/, 'Homepage musí podporovat regionální platnost.');
assert.match(homeJs, /function unitPrice\(/, 'Homepage musí počítat jednotkovou cenu.');
assert.match(homeJs, /function openCompare\(/, 'Homepage musí umět porovnat ceny produktu.');
assert.match(homeJs, /function openReport\(/, 'Homepage musí umožnit nahlášení chyby.');
assert.match(homeJs, /SAVED_KEY/, 'Homepage musí uchovávat uložené nabídky.');
assert.match(homeJs, /encodeURIComponent\(store\.slug\).*\.html/, 'Karta obchodu musí odkazovat na jeho vlastní stránku.');
assert.match(homeJs, /penny:'assets\/logos\/penny\.svg\?v=4'/, 'Homepage musí používat lokální logo PENNY.');
assert.doesNotMatch(searchSuggest, /DecompressionStream|\.home-v2-parts|MutationObserver|setInterval/, 'Pomocný skript nesmí obsahovat zavaděč ani nekonečné DOM smyčky.');

const storePageFiles = readdirSync(root)
  .filter((path) => path.endsWith('.html') && read(path).includes('window.SLEVAO_STORE'))
  .sort();
assert.equal(storePageFiles.length, 73, 'Každý z 73 obchodů musí mít vlastní stránku.');
for (const page of storePageFiles) {
  const slug = page.replace(/\.html$/, '');
  const source = read(page);
  assert.match(source, new RegExp(`window\\.SLEVAO_STORE=.*"slug":"${slug}"`), `${page} nemá správnou konfiguraci.`);
  assert.match(source, /assets\/store-feed\.js\?v=20260801-18/, `${page} nepoužívá aktuální společný feed.`);
  assert.match(source, /assets\/store-feed\.css\?v=20260801-15/, `${page} nepoužívá aktuální styly feedu.`);
  assert.match(source, /id="leafletGrid"/, `${page} nemá přehled letáků.`);
  assert.match(source, /id="leafletFrame"/, `${page} nemá vložený prohlížeč letáku.`);
  assert.match(source, /rel="canonical"/, `${page} nemá canonical URL.`);
}

const tescoFeed = read('tesco.html');
assert.match(tescoFeed, /assets\/logos\/tesco\.svg/, 'Tesco musí používat lokální logo.');
assert.match(tescoFeed, /id="categoryBar"/, 'Tesco nemá rychlé filtrování kategorií.');
assert.match(tescoFeed, /id="savedToggle"/, 'Tesco nemá uložené nabídky.');
assert.match(tescoFeed, /id="leafletGrid"/, 'Tesco nemá živou sekci letáků.');
assert.match(tescoFeed, /id="leafletFrame"/, 'Tesco nemá vložený prohlížeč letáku.');

const storeFeed = read('assets/store-feed.js');
const tescoStoreFeed = read('assets/store-feed-tesco-v8.js');
new Script(storeFeed, { filename:'assets/store-feed.js' });
new Script(tescoStoreFeed, { filename:'assets/store-feed-tesco-v8.js' });
assert.equal(tescoStoreFeed, storeFeed, 'Tesco cache-busting feed se liší od společné logiky.');
assert.match(storeFeed, /const BRAND_PROFILES = \{/, 'Společný feed nemá identity obchodů.');
assert.match(storeFeed, /function applyBrandShell\(/, 'Firemní hero se nesestavuje před databází.');
assert.match(storeFeed, /valid_from:`lte\.\$\{today\}`/, 'Feed musí skrývat budoucí nabídky.');
assert.match(storeFeed, /valid_to:`gte\.\$\{today\}`/, 'Feed musí skrývat skončené nabídky.');
assert.match(storeFeed, /setInterval\(load,5\*60\*1000\)/, 'Feed se musí automaticky obnovovat.');
assert.match(storeFeed, /loadLeaflets\(false\),10\*60\*1000/, 'Letáky se musí automaticky kontrolovat.');
assert.match(storeFeed, /FAVORITES_KEY/, 'Feed musí uchovávat oblíbené nabídky.');
assert.match(storeFeed, /URL\.createObjectURL\(documentBlob\)/, 'Leták se musí vložit jako lokální dokument.');
assert.match(storeFeed, /zoom=page-fit/, 'Leták se musí přizpůsobit dostupné ploše.');
assert.match(storeFeed, /leaflet-viewer-open/, 'Mobilní prohlížeč musí zamknout obsah pod sebou.');
assert.doesNotMatch(storeFeed, /renderHeroProducts/, 'Horní sekce obchodů nesmí obsahovat produktové fotografie.');

const storeFeedCss = read('assets/store-feed.css');
assert.match(storeFeedCss, /\.store-page--brand \.heroBox/, 'Stránky obchodů nemají značkovou horní sekci.');
assert.match(storeFeedCss, /leafletGrid\[data-count="1"\]/, 'Jediný leták nesmí zůstat v třísloupcové mřížce.');
assert.match(read('penny.html'), /"logo":"assets\/logos\/penny\.svg\?v=4"/, 'PENNY stránka nepoužívá lokální logo.');
assert.match(read('supabase/migrations/20260801190000_use_official_penny_logo_everywhere.sql'), /assets\/logos\/penny\.svg\?v=4/, 'Databáze neposkytuje stejné logo PENNY.');

const brandLogoMigration = read('supabase/migrations/20260801133000_complete_store_brand_logos.sql');
const brandedStoreSlugs = [...brandLogoMigration.matchAll(/\('([^']+)','[^']+'\)/g)].map((match) => match[1]);
assert.equal(brandedStoreSlugs.length, 73, 'Migrace musí obsahovat loga všech 73 obchodů.');
for (const page of storePageFiles) assert(brandedStoreSlugs.includes(page.replace(/\.html$/, '')), `${page} nemá zdroj loga.`);

const publicLeafletFeed = read('supabase/functions/store-leaflet-feed/index.ts');
assert.match(publicLeafletFeed, /TESCO_LISTING_URL/, 'Veřejný feed nemá oficiální Tesco zdroj.');
assert.match(publicLeafletFeed, /documentsFromOfficialHtml/, 'Tesco dokumenty se nepárují z oficiální stránky.');
assert.match(publicLeafletFeed, /async function storeLeaflets/, 'Feed neobsluhuje všechny obchody.');
assert.match(publicLeafletFeed, /storeSlug === 'penny'/, 'PENNY letáky se neslučují do jednoho boxu.');
assert.match(publicLeafletFeed, /async function pennyOfficialLeaflet/, 'PENNY nemá oficiální plný dokument.');
assert.match(publicLeafletFeed, /function actionOfficialLeaflet/, 'Action nemá oficiální týdenní katalog.');
assert.doesNotMatch(publicLeafletFeed, /error_message|metadata/, 'Veřejný feed zpřístupňuje interní diagnostiku.');
assert.match(read('supabase/functions/store-leaflet-feed/config.toml'), /verify_jwt = false/, 'Veřejný feed vyžaduje přihlášení návštěvníka.');

const publicLeafletDocument = read('supabase/functions/store-leaflet-document/index.ts');
assert.match(publicLeafletDocument, /digitalcontent\.api\.tesco\.com/, 'Dokumentový proxy nepovoluje Tesco.');
assert.match(publicLeafletDocument, /PennyIntLeaflet/, 'Dokumentový proxy nepovoluje PENNY.');
assert.match(publicLeafletDocument, /source_url/, 'Dokumentový proxy nepřijímá přesnou URL dokumentu.');
assert.match(publicLeafletDocument, /allowedStatuses/, 'Dokumentový proxy neověřuje stav importu.');
assert.match(publicLeafletDocument, /detected_valid_to/, 'Dokumentový proxy neodmítá prošlé letáky.');
assert.match(publicLeafletDocument, /createSignedUrl/, 'Dokumentový proxy nevytváří podepsaný odkaz.');
assert.doesNotMatch(publicLeafletDocument, /Response\.redirect/, 'Dokumentový proxy používá CORS blokované přesměrování.');
assert.match(read('supabase/functions/store-leaflet-document/config.toml'), /verify_jwt = false/, 'Prohlížeč letáku vyžaduje přihlášení návštěvníka.');

for (const path of ['admin-fotografie.html','admin-pridat-fotografii.html']) {
  const scripts = [...read(path).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert(scripts.length > 0, `${path} neobsahuje aplikační JavaScript.`);
  for (const source of scripts) new Script(source, { filename:`${path}:inline-script` });
}
assert.match(read('admin-pridat-fotografii.html'), /function resolveSelectedProduct\(\)/, 'Výběr produktu pro fotografii není spolehlivý.');
assert.match(read('admin-pridat-fotografii.html'), /await productsReady/, 'Výběr produktu nečeká na databázi.');
assert.match(read('admin-pridat-fotografii.html'), /slevao-photo-product-id/, 'Vybraný produkt nepřežije obnovení stránky.');
assert.match(read('admin-pridat-fotografii.html'), /type="file" accept="image\/jpeg,image\/png,image\/webp,image\/avif"/, 'Nahrání fotografie nepovoluje bezpečné formáty.');
assert.match(read('admin-pridat-fotografii.html'), /8\*1024\*1024/, 'Prohlížeč neomezuje fotografii na 8 MB.');

const redirects = {
  'login.html':'admin.html', 'moderation.html':'admin.html', 'account.html':'./', 'collections.html':'./',
  'detail.html':'./', 'reels.html':'./', 'submit.html':'./', 'index2.html':'./',
};
for (const [path,target] of Object.entries(redirects)) {
  const source = read(path);
  assert.match(source, /noindex/, `${path} musí být vyřazen z indexace.`);
  assert(source.includes(`url=${target}`), `${path} nemíří na ${target}.`);
}

const functionPaths = readdirSync(new URL('supabase/functions/', root), { withFileTypes:true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `supabase/functions/${entry.name}/index.ts`)
  .filter(exists);
const functionSources = functionPaths.map(read).join('\n');
assert(!/user_metadata\?\.role/.test(functionSources), 'Oprávnění nesmí vycházet z user_metadata.');
for (const path of ['supabase/functions/discover-leaflets/index.ts','supabase/functions/discover-coop/index.ts','supabase/functions/discover-hruska/index.ts']) {
  assert.match(read(path), /if \(!CRON_SECRET\)/, `${path} musí selhat při chybějícím CRON_SECRET.`);
}

const imageDiscovery = read('supabase/functions/discover-product-images/index.ts');
assert.match(imageDiscovery, /if \(!isService && !isCron && !isStaff\)/, 'Vyhledávání fotografií neověřuje oprávnění.');
assert.match(imageDiscovery, /product_image_candidates/, 'Vyhledávání fotografií nepoužívá schvalovací frontu.');
const manualUpload = read('supabase/functions/upload-product-image/index.ts');
assert.match(manualUpload, /app_metadata\?\.role/, 'Nahrání fotografie neověřuje roli správce.');
assert.match(manualUpload, /function detectedType/, 'Nahrání nekontroluje skutečný formát souboru.');
assert.match(manualUpload, /product_image_candidates/, 'Nahraná fotografie nekončí ve schvalovací frontě.');
assert.match(manualUpload, /source_type: "manual"/, 'Ruční fotografie není označena jako ruční zdroj.');

assert.match(read('admin-automatizace.html'), /if\(!x\.is_active\)return\{key:'paused'/, 'Pozastavené zdroje se počítají jako poruchy.');
assert.match(read('admin-automatizace.html'), /latestImportBySource\.get\(x\.id\)/, 'Stav zdroje nezohledňuje poslední import.');
assert.match(read('supabase/functions/discover-leaflets/index.ts'), /SPECIALIZED_SOURCE_SLUGS\.has/, 'Generický průzkum nepřeskakuje specializované zdroje.');
assert.match(read('supabase/functions/discover-leaflets/index.ts'), /store:penny-flippingbook/, 'PENNY nepoužívá adaptér pro celý leták.');
assert.match(read('supabase/functions/discover-leaflets/index.ts'), /store:action-web/, 'Action hledá neexistující PDF místo webového katalogu.');
assert.match(read('supabase/functions/process-leaflet/index.ts'), /canArchiveInStorage = bytes\.length <= 45/, 'Velké letáky nemají náhradní cestu zpracování.');

assert.equal((read('sitemap.xml').match(/<url>/g) || []).length, 74, 'Sitemap musí obsahovat homepage a 73 obchodů.');
assert.match(read('robots.txt'), /Sitemap: https:\/\/slevao\.cz\/sitemap\.xml/, 'robots.txt neodkazuje na sitemapu.');
assert.match(read('sitemap.xml'), /<loc>https:\/\/slevao\.cz\/<\/loc>/, 'Sitemap neobsahuje homepage.');

console.log('Slevao.cz quality checks: OK');
