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

const requiredWorkflows = new Set([
  'automatic-leaflets.yml', 'deploy-edge-functions.yml', 'deploy-official-leaflet-resolver.yml',
  'deploy-publish-imports.yml', 'discover-product-images.yml', 'match-product-catalog.yml', 'quality.yml',
]);
const workflows = readdirSync(new URL('.github/workflows/', root)).filter((path) => path.endsWith('.yml')).sort();
const workflowSet = new Set(workflows);
for (const path of requiredWorkflows) {
  assert(workflowSet.has(path), `Chybí povinné GitHub workflow: ${path}`);
}
const allowedContentWriters = new Set(['generate-product-sitemap.yml']);
for (const path of workflows) {
  const source = read(`.github/workflows/${path}`);
  const writesContents = /permissions:\s*[\s\S]{0,100}contents:\s*write/.test(source);
  assert(!writesContents || allowedContentWriters.has(path), `${path} nesmí automaticky přepisovat zdrojový kód.`);
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

for (const pattern of [
  /async function fetchOffers\(/, /for \(let from = 0; ; from \+= 1000\)/, /function deduplicate\(/,
  /AbortController/, /CACHE_KEY/, /return collect\(simpleSelect\)/, /location\.reload\(\)/,
  /function categoryOf\(/, /function geographyMatches\(/, /function unitPrice\(/,
  /function openCompare\(/, /function openReport\(/, /SAVED_KEY/,
]) assert.match(homeJs, pattern, `Homepage postrádá povinnou logiku ${pattern}.`);
assert.match(homeJs, /encodeURIComponent\(store\.slug\).*\.html/, 'Karta obchodu musí odkazovat na jeho vlastní stránku.');
assert.match(homeJs, /penny:'assets\/logos\/penny\.svg\?v=4'/, 'Homepage musí používat lokální logo PENNY.');
assert.doesNotMatch(searchSuggest, /DecompressionStream|\.home-v2-parts|MutationObserver|setInterval/, 'Pomocný skript obsahuje starý zavaděč nebo nekonečnou DOM smyčku.');

const storePageFiles = readdirSync(root)
  .filter((path) => path.endsWith('.html') && read(path).includes('window.SLEVAO_STORE'))
  .sort();
assert.equal(storePageFiles.length, 73, 'Každý z 73 obchodů musí mít vlastní stránku.');
for (const page of storePageFiles) {
  const slug = page.replace(/\.html$/, '');
  const source = read(page);
  assert.match(source, new RegExp(`window\\.SLEVAO_STORE=.*"slug":"${slug}"`), `${page} nemá správnou konfiguraci.`);
  assert.match(source, /assets\/store-feed\.js\?v=\d+-\d+/, `${page} nepoužívá verzovaný společný feed.`);
  assert.match(source, /assets\/store-feed\.css\?v=\d+-\d+/, `${page} nepoužívá verzované společné styly feedu.`);
  assert.match(source, /id="leafletGrid"/, `${page} nemá přehled letáků.`);
  assert.match(source, /id="leafletFrame"/, `${page} nemá vložený prohlížeč letáku.`);
  assert.match(source, /rel="canonical"/, `${page} nemá canonical URL.`);
}

const tescoFeed = read('tesco.html');
assert.match(tescoFeed, /assets\/logos\/tesco\.svg/, 'Tesco musí používat lokální logo.');
for (const id of ['categoryBar','savedToggle','leafletGrid','leafletFrame']) assert(tescoFeed.includes(`id="${id}"`), `Tesco postrádá ${id}.`);

const storeFeed = read('assets/store-feed.js');
const tescoStoreFeed = read('assets/store-feed-tesco-v8.js');
new Script(storeFeed, { filename:'assets/store-feed.js' });
new Script(tescoStoreFeed, { filename:'assets/store-feed-tesco-v8.js' });
assert.equal(tescoStoreFeed, storeFeed, 'Tesco cache-busting feed se liší od společné logiky.');
for (const pattern of [
  /const BRAND_PROFILES = \{/, /function applyBrandShell\(/,
  /valid_from:`lte\.\$\{today\}`/, /valid_to:`gte\.\$\{today\}`/,
  /setInterval\(load,5\*60\*1000\)/, /loadLeaflets\(false\),10\*60\*1000/,
  /FAVORITES_KEY/, /URL\.createObjectURL\(documentBlob\)/, /zoom=page-fit/, /leaflet-viewer-open/,
]) assert.match(storeFeed, pattern, `Společný feed postrádá ${pattern}.`);
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
for (const pattern of [
  /TESCO_LISTING_URL/, /documentsFromOfficialHtml/, /async function storeLeaflets/,
  /storeSlug === 'penny'/, /async function pennyOfficialLeaflet/, /function actionOfficialLeaflet/,
]) assert.match(publicLeafletFeed, pattern, `Veřejný feed postrádá ${pattern}.`);
assert.doesNotMatch(publicLeafletFeed, /error_message|metadata/, 'Veřejný feed zpřístupňuje interní diagnostiku.');
assert.match(read('supabase/functions/store-leaflet-feed/config.toml'), /verify_jwt = false/, 'Veřejný feed vyžaduje přihlášení návštěvníka.');

const publicLeafletDocument = read('supabase/functions/store-leaflet-document/index.ts');
for (const pattern of [/digitalcontent\.api\.tesco\.com/,/PennyIntLeaflet/,/source_url/,/allowedStatuses/,/detected_valid_to/,/\.storage\.from\(bucket\)\.download\(path\)/,/storedDocument\.stream\(\)/]) {
  assert.match(publicLeafletDocument, pattern, `Dokumentový proxy postrádá ${pattern}.`);
}
assert.doesNotMatch(publicLeafletDocument, /Response\.redirect/, 'Dokumentový proxy používá CORS blokované přesměrování.');
assert.doesNotMatch(publicLeafletDocument, /createSignedUrl/, 'Dokumentový proxy nesmí zveřejňovat podepsanou adresu Supabase Storage.');
assert.match(read('supabase/functions/store-leaflet-document/config.toml'), /verify_jwt = false/, 'Prohlížeč letáku vyžaduje přihlášení návštěvníka.');

for (const path of ['admin-fotografie.html','admin-pridat-fotografii.html']) {
  const scripts = [...read(path).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert(scripts.length > 0, `${path} neobsahuje aplikační JavaScript.`);
  for (const source of scripts) new Script(source, { filename:`${path}:inline-script` });
}
const photoAdmin = read('admin-pridat-fotografii.html');
for (const pattern of [/function resolveSelectedProduct\(\)/,/await productsReady/,/slevao-photo-product-id/,/8\*1024\*1024/]) {
  assert.match(photoAdmin, pattern, `Administrace fotografií postrádá ${pattern}.`);
}
assert.match(photoAdmin, /type="file" accept="image\/jpeg,image\/png,image\/webp,image\/avif"/, 'Nahrání fotografie nepovoluje bezpečné formáty.');

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
for (const pattern of [/app_metadata\?\.role/,/function detectedType/,/product_image_candidates/,/source_type: "manual"/]) {
  assert.match(manualUpload, pattern, `Ruční nahrávání fotografií postrádá ${pattern}.`);
}

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
