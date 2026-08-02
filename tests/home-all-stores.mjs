import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const allStores = read('assets/home-all-stores.js');
const homepage = read('index.html');

new Script(allStores, { filename: 'assets/home-all-stores.js' });

assert.match(homepage, /<script src="assets\/home-all-stores\.js\?v=20260802-2" defer><\/script>/, 'Homepage přímo nenačítá seznam všech aktivních obchodů.');
assert.match(allStores, /is_active:\s*'eq\.true'/, 'Veřejný seznam nenačítá aktivní obchody.');
assert.match(allStores, /stores\.slice\(0, 11\)/, 'Sbalený seznam obchodů nemá správný limit.');
assert.match(allStores, /storeCount[^\n]*stores\.length/, 'Počet obchodů nezahrnuje všechny aktivní obchody.');
assert.match(allStores, /storeSelect/, 'Nové obchody se nepřidávají do filtru nabídek.');
assert.match(allStores, /class="storePageLink"[^\n]*encodeURIComponent\(store\.slug\)[^\n]*\.html/, 'Nově přidaná karta obchodu nemá odkaz na vlastní stránku.');
assert.doesNotMatch(allStores, /activeSlugs|activeIds|offers[^\n]*filter/, 'Veřejný seznam znovu filtruje obchody podle existence nabídek.');

console.log('Homepage active stores OK');
