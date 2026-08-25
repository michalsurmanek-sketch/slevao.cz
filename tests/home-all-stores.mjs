import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const allStores = read('assets/home-all-stores.js');
const homepage = read('index.html');
const homepageRuntime = read('assets/home-v2.js');

new Script(allStores, { filename: 'assets/home-all-stores.js' });
new Script(homepageRuntime, { filename: 'assets/home-v2.js' });

assert.match(homepage, /<script src="assets\/home-all-stores\.js\?v=[a-z0-9-]+" defer><\/script>/i, 'Homepage přímo nenačítá aktuální seznam obchodů.');
assert.match(allStores, /public_store_feed_health/, 'Veřejný seznam obchodů nepoužívá autoritativní feed-health vrstvu.');
assert.match(allStores, /is_active:\s*'eq\.true'/, 'Veřejný seznam nenačítá aktivní obchody.');
assert.match(allStores, /feed_status,current_offer_count,current_leaflet_count,image_coverage_pct,health_score/, 'Homepage nenačítá stav a kvalitu feedu obchodů.');
assert.match(allStores, /select:\\s*'store_id,name,slug,logo_url,primary_color,is_active,feed_status,current_offer_count,current_leaflet_count,image_coverage_pct,health_score'/, 'Veřejný seznam musí používat skutečný sloupec store_id z feed-health view.');
assert.doesNotMatch(allStores, /store_id:id/, 'Veřejný seznam nesmí požadovat neexistující sloupec id z feed-health view.');
assert.match(allStores, /function feedStateLabel\(/, 'Homepage neumí vysvětlit obchod bez živého produktového feedu.');
for (const label of ['Jen aktuální leták','Zdroj se obnovuje','Dočasně bez nabídek','Zatím bez nabídek']) {
  assert(allStores.includes(label), `Homepage postrádá stav obchodu: ${label}`);
}
assert.match(allStores, /STORE_PRIORITY[\s\S]*'lidl'[\s\S]*'kaufland'[\s\S]*'penny'[\s\S]*'albert'/, 'Hlavní obchody nemají nastavené prioritní pořadí.');
assert.match(allStores, /sortStores[\s\S]*rankStore\(a\) - rankStore\(b\)/, 'Obchody se neřadí podle prioritního hodnocení.');
assert.match(allStores, /localeCompare\([^\n]*'cs'/, 'Neznámé obchody nemají abecední záložní řazení.');
assert.match(allStores, /stores\.slice\(0, 11\)/, 'Sbalený seznam obchodů nemá správný limit.');
assert.match(allStores, /storeSelect/, 'Nové obchody se nepřidávají do filtru nabídek.');
assert.match(allStores, /class="storePageLink"[^\n]*encodeURIComponent\(store\.slug\)[^\n]*\.html/, 'Nově přidaná karta obchodu nemá odkaz na vlastní stránku.');
assert.doesNotMatch(allStores, /order:\s*'name\.asc'/, 'Homepage nesmí znovu řadit obchody čistě podle abecedy.');
assert.doesNotMatch(allStores, /activeSlugs|activeIds|offers[^\n]*filter/, 'Veřejný seznam znovu filtruje obchody podle existence nabídek.');
assert.match(allStores, /function stabilizeDealsScroll\(\)/, 'Výběr obchodu nemá vlastní dorovnání scrollu po změně výšky seznamu.');
assert.match(allStores, /new MutationObserver\(scheduleSync\)/, 'Scroll po výběru obchodu nereaguje na překreslení seznamu.');
assert.match(allStores, /\[90, 180, 320, 520\]\.forEach/, 'Scroll po výběru obchodu nemá opakované dorovnání po změně rozložení.');
assert.match(allStores, /stabilizeDealsScroll\(\)/, 'Kliknutí na obchod nepoužívá stabilizovaný scroll.');
assert.match(homepageRuntime, /refreshCurrent\(\)\.then\(scrollToDealsAfterStoreLayout\)/, 'Datový runtime po výběru obchodu nedokončí scroll až po načtení serverových výsledků.');

assert.match(allStores, /const STORE_REFRESH_MS = 5 \* 60 \* 1000;/, 'Adresář obchodů nemá jednotné pětiminutové freshness okno.');
assert.match(allStores, /lastStoresRefreshAt = Date\.now\(\);/, 'Úspěšné načtení obchodů nezapisuje čas poslední aktualizace.');
assert.match(allStores, /document\.addEventListener\('visibilitychange'/, 'Adresář obchodů nereaguje na návrat uživatele na kartu.');
assert.match(allStores, /Date\.now\(\) - lastStoresRefreshAt >= STORE_REFRESH_MS/, 'Návrat na kartu neobnovuje pouze zastaralý adresář obchodů.');
assert.match(allStores, /if \(!document\.hidden\) refreshStores\(\);/, 'Periodický refresh musí zůstat pozastavený na skryté kartě.');
assert.match(allStores, /\}, STORE_REFRESH_MS\);/, 'Periodický refresh nepoužívá stejné freshness okno.');

console.log('Homepage priority stores OK');
