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

const inlineScripts = [...index.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert(inlineScripts.length > 0, 'Homepage neobsahuje aplikační JavaScript.');
for (const source of inlineScripts) new Script(source, { filename: 'index.html:inline-script' });
new Script(read('assets/search-suggest.js'), { filename: 'assets/search-suggest.js' });
assert.doesNotMatch(read('assets/search-suggest.js'), /MutationObserver|setInterval/, 'Loga nesmí vytvářet nekonečnou smyčku změn DOM.');
assert.match(index, /search-suggest\.js\?v=20260801-freeze-fix/, 'Opravený skript musí obejít starou cache prohlížeče.');
for (const path of ['admin-fotografie.html']) {
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
