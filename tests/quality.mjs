import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const requiredFiles = [
  'index.html', 'admin.html', 'admin-automatizace.html', 'robots.txt',
  'sitemap.xml', 'favicon.svg', 'assets/search-suggest.css',
  'assets/search-suggest.js',
];

const expectedWorkflows = [
  'automatic-leaflets.yml',
  'deploy-edge-functions.yml',
  'deploy-publish-imports.yml',
  'discover-product-images.yml',
  'match-product-catalog.yml',
  'quality.yml',
];
const workflows = readdirSync(new URL('../.github/workflows', import.meta.url))
  .filter((path) => path.endsWith('.yml'))
  .sort();
assert.deepEqual(workflows, expectedWorkflows, 'Repozitář obsahuje zastaralé nebo chybějící GitHub workflow.');
for (const path of workflows) {
  const source = read(`.github/workflows/${path}`);
  assert(!/permissions:\s*[\s\S]{0,80}contents:\s*write/.test(source), `${path} nesmí automaticky přepisovat zdrojový kód.`);
}

for (const path of requiredFiles) {
  assert(existsSync(new URL(`../${path}`, import.meta.url)), `Chybí povinný soubor: ${path}`);
}

const index = read('index.html');
assert.match(index, /<link rel="canonical" href="https:\/\/slevao\.cz\/">/, 'Homepage nemá canonical URL.');
assert.match(index, /application\/ld\+json/, 'Homepage nemá strukturovaná data.');
assert.match(index, /<meta property="og:title"/, 'Homepage nemá Open Graph metadata.');
assert.match(index, /fetchActiveOffers/, 'Katalog musí podporovat stránkované načítání z databáze.');
assert.match(index, /deduplicateOffers/, 'Katalog musí mít ochranu proti duplicitám.');
assert.match(index, /AbortController/, 'Databázové načítání musí mít přerušitelný časový limit.');
assert.match(index, /retryRequest/, 'Databázové načítání se musí po přechodné chybě zopakovat.');
assert.match(index, /id="retryLoad"/, 'Chyba načítání musí nabídnout ruční opakování.');
assert.match(index, /DATA_CACHE_KEY/, 'Homepage musí umět zobrazit poslední funkční data při výpadku.');
assert.doesNotMatch(index, /cdn\.jsdelivr\.net\/npm\/@supabase/, 'Homepage nesmí záviset na externím Supabase SDK z CDN.');
assert.doesNotMatch(index, /filter\(s=>activeSlugs\.has/, 'Homepage nesmí skrývat aktivní obchody bez aktuální nabídky.');
assert.match(index, /href="\$\{encodeURIComponent\(s\.slug\)\}\.html"/, 'Karta obchodu musí vést na jeho vlastní feedovou stránku.');
for (const slug of ['tesco', 'kaufland', 'lidl', 'coop', 'hruska', 'dr-max']) {
  const feed = read(`${slug}.html`);
  assert.match(feed, new RegExp(`window\\.SLEVAO_STORE=.*"slug":"${slug}"`), `${slug}.html nemá správnou konfiguraci obchodu.`);
  assert.match(feed, /assets\/store-feed\.js\?v=20260801-4/, `${slug}.html nepoužívá aktuální verzi společného živého feedu.`);
  assert.match(feed, /rel="canonical"/, `${slug}.html nemá canonical URL.`);
}
const tescoFeed = read('tesco.html');
assert.match(tescoFeed, /assets\/logos\/tesco\.svg/, 'Tesco stránka musí používat lokální pravé logo.');
assert.match(tescoFeed, /id="categoryBar"/, 'Tesco stránka musí obsahovat rychlé filtrování kategorií.');
assert.match(tescoFeed, /id="savedToggle"/, 'Tesco stránka musí umožnit zobrazit uložené nabídky.');
assert.match(tescoFeed, /id="leafletGrid"/, 'Tesco stránka musí obsahovat živou sekci aktuálních letáků.');
const storeFeed = read('assets/store-feed.js');
new Script(storeFeed, { filename: 'assets/store-feed.js' });
assert.doesNotMatch(storeFeed, /\$\('storeName'\)/, 'Feed nesmí zapisovat do neexistujícího prvku názvu obchodu.');
assert.match(storeFeed, /valid_from:`lte\.\$\{today\}`/, 'Feed obchodu musí načítat pouze již platné nabídky.');
assert.match(storeFeed, /valid_to:`gte\.\$\{today\}`/, 'Feed obchodu musí skrývat skončené nabídky.');
assert.match(storeFeed, /setInterval\(load,5\*60\*1000\)/, 'Feed obchodu se musí průběžně automaticky obnovovat.');
assert.match(storeFeed, /FAVORITES_KEY/, 'Feed musí uchovat oblíbené nabídky mezi návštěvami.');
assert.match(storeFeed, /renderHeroProducts/, 'Tesco hero musí používat fotografie ze živého feedu.');
assert.match(storeFeed, /store-leaflet-feed/, 'Tesco stránka musí načítat letáky z bezpečného veřejného feedu.');
const publicLeafletFeed = read('supabase/functions/store-leaflet-feed/index.ts');
assert.match(publicLeafletFeed, /TESCO_LISTING_URL/, 'Veřejný feed letáků musí vycházet z oficiálního iTesco zdroje.');
assert.doesNotMatch(publicLeafletFeed, /error_message|metadata/, 'Veřejný feed nesmí zpřístupňovat interní diagnostiku importů.');
assert.match(read('supabase/functions/store-leaflet-feed/config.toml'), /verify_jwt = false/, 'Veřejný feed letáků musí fungovat bez přihlášení návštěvníka.');
assert.equal((read('sitemap.xml').match(/<url>/g) || []).length, 74, 'Sitemap musí obsahovat homepage a všech 73 obchodních feedů.');

const inlineScripts = [...index.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert(inlineScripts.length > 0, 'Homepage neobsahuje aplikační JavaScript.');
for (const source of inlineScripts) new Script(source, { filename: 'index.html:inline-script' });
new Script(read('assets/search-suggest.js'), { filename: 'assets/search-suggest.js' });
assert.doesNotMatch(read('assets/search-suggest.js'), /MutationObserver|setInterval/, 'Loga nesmí vytvářet nekonečnou smyčku změn DOM.');
assert.match(index, /search-suggest\.js\?v=20260801-freeze-fix/, 'Opravený skript musí obejít starou cache prohlížeče.');
for (const path of ['admin-fotografie.html', 'admin-pridat-fotografii.html']) {
  const scripts = [...read(path).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert(scripts.length > 0, `${path} neobsahuje aplikační JavaScript.`);
  for (const source of scripts) new Script(source, { filename: `${path}:inline-script` });
}

const redirects = {
  'login.html': 'admin.html',
  'moderation.html': 'admin.html',
  'account.html': './',
  'collections.html': './',
  'detail.html': './',
  'reels.html': './',
  'submit.html': './',
  'index2.html': './',
};
for (const [path, target] of Object.entries(redirects)) {
  const html = read(path);
  assert.match(html, /noindex/, `${path} musí být vyřazen z indexace.`);
  assert(html.includes(`url=${target}`), `${path} nemíří na ${target}.`);
}

const functionPaths = readdirSync(new URL('../supabase/functions', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `supabase/functions/${entry.name}/index.ts`)
  .filter((path) => existsSync(new URL(`../${path}`, import.meta.url)));
const functionSources = functionPaths.map(read).join('\n');
assert(!/user_metadata\?\.role/.test(functionSources), 'Oprávnění nesmí vycházet z user_metadata.');
for (const path of ['supabase/functions/discover-leaflets/index.ts', 'supabase/functions/discover-coop/index.ts', 'supabase/functions/discover-hruska/index.ts']) {
  assert.match(read(path), /if \(!CRON_SECRET\)/, `${path} musí selhat při chybějícím CRON_SECRET.`);
}

const imageDiscovery = read('supabase/functions/discover-product-images/index.ts');
assert.match(imageDiscovery, /if \(!isService && !isCron && !isStaff\)/, 'Vyhledávání fotografií musí vyžadovat oprávnění.');
assert.match(imageDiscovery, /product_image_candidates/, 'Vyhledávání fotografií musí používat schvalovací frontu.');
assert.match(imageDiscovery, /order\("image_checked_at"/, 'Vyhledávání fotografií musí postupovat přes dosud neprověřené produkty.');
assert.match(read('admin-fotografie.html'), /select\('\*',\{count:'exact'\}\)/, 'Administrace fotografií musí zobrazovat přesný počet chybějících fotografií.');
assert.match(read('admin-pridat-fotografii.html'), /function resolveSelectedProduct\(\)/, 'Ruční doplnění fotografie musí obnovit přesný produkt z vyhledávacího pole.');
assert.match(read('admin-pridat-fotografii.html'), /await productsReady/, 'Výběr produktu musí počkat na načtení produktů z databáze.');
assert.match(read('admin-pridat-fotografii.html'), /slevao-photo-product-id/, 'Vybraný produkt musí přežít obnovení stránky.');
assert.match(read('admin-pridat-fotografii.html'), /activeCompatible\.length===1/, 'Při duplicitním názvu se musí vybrat jediný produkt s aktivní nabídkou.');
assert.match(read('supabase/functions/inspect-product-page/index.ts'), /canonicalTescoUrl\(target\)/, 'Ruční kontrola Tesco produktu musí obejít blokovanou URL s měřicími parametry.');
assert.match(read('supabase/functions/inspect-product-page/index.ts'), /hasStrongBrandQuantityMatch/, 'Ruční kontrola fotografie musí umět bezpečnou shodu značky a množství.');
assert.match(read('supabase/functions/inspect-product-page/index.ts'), /staff_direct_image/, 'Správce musí umět uložit přímý oficiální obrázek do schvalovací fronty.');
assert.doesNotMatch(read('admin-pridat-fotografii.html'), /Fotografie už je uložená ve frontě/, 'Formulář nesmí tvrdit, že přímý obrázek uložil, dokud ho neposlal backendu.');
assert.match(read('admin-pridat-fotografii.html'), /type="file" accept="image\/jpeg,image\/png,image\/webp,image\/avif"/, 'Ruční doplnění musí umožnit bezpečný výběr fotografie z počítače.');
assert.match(read('admin-pridat-fotografii.html'), /8\*1024\*1024/, 'Prohlížeč musí odmítnout fotografii větší než 8 MB.');
const manualUpload = read('supabase/functions/upload-product-image/index.ts');
assert.match(manualUpload, /app_metadata\?\.role/, 'Nahrání fotografie musí ověřovat oprávnění správce.');
assert.match(manualUpload, /function detectedType/, 'Nahrání musí ověřit skutečný formát souboru podle jeho obsahu.');
assert.match(manualUpload, /product_image_candidates/, 'Nahraná fotografie musí skončit ve schvalovací frontě.');
assert.match(manualUpload, /source_type: "manual"/, 'Nahraná fotografie musí být označena jako ruční zdroj.');
const missingImageView = read('supabase/migrations/20260801143000_hide_products_with_image_candidates.sql');
assert.match(missingImageView, /not exists[\s\S]*product_image_candidates/, 'Produkty s kandidátní fotografií nesmí zůstávat v seznamu bez fotografie.');
assert.match(missingImageView, /status in \('pending', 'approved'\)/, 'Seznam bez fotografie musí skrýt čekající i schválené kandidáty.');
assert.match(read('admin-automatizace.html'), /if\(!x\.is_active\)return\{key:'paused'/, 'Pozastavené zdroje se nesmí počítat jako poruchy automatizace.');
assert.match(read('admin-automatizace.html'), /latestImportBySource\.get\(x\.id\)/, 'Stav zdroje musí zohlednit jeho poslední import.');
assert.match(read('admin-automatizace.html'), /latest\?\.status==='failed'/, 'Poslední neúspěšný import musí označit zdroj jako problém.');
for (const path of ['supabase/functions/enrich-offer-images/index.ts', 'supabase/functions/backfill-tesco-images/index.ts']) {
  const source = read(path);
  assert.match(source, /product_image_candidates/, `${path} musí ukládat nejisté obrázky do schvalovací fronty.`);
  assert(!/from\('offers'\)\.update\(\{ image_url: match\./.test(source), `${path} nesmí heuristickou fotografii rovnou zveřejnit.`);
}
assert.match(read('supabase/functions/discover-coop/index.ts'), /soukrom\|osobn/, 'COOP nesmí vybrat dokument o ochraně osobních údajů jako leták.');
assert.match(read('supabase/functions/process-leaflet/index.ts'), /updateBucket\(STORAGE_BUCKET/, 'Úložiště letáků musí zvýšit limit i u již existujícího bucketu.');
assert.match(read('supabase/functions/sync-coop-source/index.ts'), /soukrom\|osobn/, 'Používaný COOP synchronizátor nesmí vybrat dokument o ochraně osobních údajů.');
assert.match(read('supabase/functions/process-leaflet/index.ts'), /canArchiveInStorage = bytes\.length <= 45/, 'Velké letáky musí obejít omezené úložiště a pokračovat přímo do zpracování.');
assert.match(read('supabase/functions/discover-leaflets/index.ts'), /SPECIALIZED_SOURCE_SLUGS\.has/, 'Generický průzkum musí přeskočit obchody s vlastním synchronizátorem.');

const publicSources = [
  'login.html', 'moderation.html', 'account.html', 'collections.html',
  'detail.html', 'reels.html', 'submit.html', 'index2.html',
].map(read).join('\n');
assert(!/ADMIN_PIN|cdn\.tailwindcss\.com|zatím lokálně/.test(publicSources), 'Na web se vrátil vývojový prototyp.');

const robots = read('robots.txt');
assert.match(robots, /Sitemap: https:\/\/slevao\.cz\/sitemap\.xml/, 'robots.txt neodkazuje na sitemapu.');
assert.match(read('sitemap.xml'), /<loc>https:\/\/slevao\.cz\/<\/loc>/, 'Sitemap neobsahuje homepage.');

console.log('Slevao.cz quality checks: OK');
