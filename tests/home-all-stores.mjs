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
assert.match(allStores, /is_active:\s*'eq\.true'/, 'Veřejný seznam nenačítá aktivní obchody.');
assert.match(allStores, /STORE_PRIORITY[\s\S]*'lidl'[\s\S]*'kaufland'[\s\S]*'penny'[\s\S]*'albert'/, 'Hlavní obchody nemají nastavené prioritní pořadí.');
assert.match(allStores, /sortStores[\s\S]*rankStore\(a\) - rankStore\(b\)/, 'Obchody se neřadí podle prioritního hodnocení.');
assert.match(allStores, /localeCompare\([^\n]*'cs'/, 'Neznámé obchody nemají abecední záložní řazení.');
assert.match(allStores, /stores\.slice\(0, 11\)/, 'Sbalený seznam obchodů nemá správný limit.');
assert.match(allStores, /storeCount[^\n]*stores\.length/, 'Počet obchodů nezahrnuje všechny aktivní obchody.');
assert.match(allStores, /storeSelect/, 'Nové obchody se nepřidávají do filtru nabídek.');
assert.match(allStores, /class="storePageLink"[^\n]*encodeURIComponent\(store\.slug\)[^\n]*\.html/, 'Nově přidaná karta obchodu nemá odkaz na vlastní stránku.');
assert.doesNotMatch(allStores, /order:\s*'name\.asc'/, 'Homepage nesmí znovu řadit obchody čistě podle abecedy.');
assert.doesNotMatch(allStores, /activeSlugs|activeIds|offers[^\n]*filter/, 'Veřejný seznam znovu filtruje obchody podle existence nabídek.');
assert.match(allStores, /function stabilizeDealsScroll\(\)/, 'Výběr obchodu nemá vlastní dorovnání scrollu po změně výšky seznamu.');
assert.match(allStores, /new MutationObserver\(scheduleSync\)/, 'Scroll po výběru obchodu nereaguje na překreslení seznamu.');
assert.match(allStores, /\[90, 180, 320, 520\]\.forEach/, 'Scroll po výběru obchodu nemá opakované dorovnání po změně rozložení.');
assert.match(allStores, /stabilizeDealsScroll\(\)/, 'Kliknutí na obchod nepoužívá stabilizovaný scroll.');
assert.match(homepageRuntime, /refreshCurrent\(\)\.then\(scrollToDealsAfterStoreLayout\)/, 'Datový runtime po výběru obchodu nedokončí scroll až po načtení serverových výsledků.');

console.log('Homepage priority stores OK');
