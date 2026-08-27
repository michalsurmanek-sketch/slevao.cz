import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const bootstrap = readFileSync(new URL('assets/rpc-request-dedupe.js', root), 'utf8');
const homeSync = readFileSync(new URL('assets/home-favorite-offer-sync.js', root), 'utf8');
const homeProduct = readFileSync(new URL('assets/home-product-favorites.js', root), 'utf8');
const personalization = readFileSync(new URL('assets/product-personalization.js', root), 'utf8');
const storeRuntime = readFileSync(new URL('assets/store-bottom-nav.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(bootstrap, { filename:'assets/rpc-request-dedupe.js' });
new Script(homeSync, { filename:'assets/home-favorite-offer-sync.js' });
new Script(homeProduct, { filename:'assets/home-product-favorites.js' });
new Script(personalization, { filename:'assets/product-personalization.js' });
new Script(storeRuntime, { filename:'assets/store-bottom-nav.js' });

assert.doesNotMatch(bootstrap, /localStorage|sessionStorage|setInterval/, 'Facets dedupe bootstrap nesmí převzít persistentní Storage ani intervalovou cache logiku.');
const retryStart = bootstrap.indexOf('  function fetchWithReadRetry');
const retryEnd = bootstrap.indexOf('\n  function contextualFacetBody', retryStart);
assert.ok(retryStart >= 0 && retryEnd > retryStart, 'Facets bootstrap nemá izolovatelný bounded read retry.');
const retrySource = bootstrap.slice(retryStart, retryEnd);
assert.match(retrySource, /window\.setTimeout\(resolve, RETRY_DELAY_MS\)/, 'Jediný timeout musí patřit krátkému read-only RPC retry.');
assert.equal((bootstrap.match(/setTimeout/g) || []).length, 1, 'Facets bootstrap nesmí přidat další timer mimo bounded read retry.');

const favoriteSyncUrl = bootstrap.match(/syncScript\.src = '([^']+)'/)?.[1] || '';
assert.match(favoriteSyncUrl, /^assets\/home-favorite-offer-sync\.js\?v=[0-9-]+$/, 'Homepage bootstrap nenačítá verzovaný oddělený favorite sync runtime.');
assert.match(bootstrap, /syncScript\.async = false;/, 'Favorite sync loader nemá stabilní ordered-script režim.');

assert.match(homeSync, /const HOME_FAVORITES_KEY = 'slevao-saved';/, 'Homepage bridge nehlídá homepage favorites klíč.');
assert.match(homeSync, /const STORE_FAVORITES_KEY = 'slevao-favorite-offers-v1';/, 'Homepage bridge nehlídá store favorites klíč.');
assert.match(homeSync, /function mergeFavoriteLists\(\.\.\.lists\)/, 'Homepage bridge nemá union helper.');
assert.match(homeSync, /available\.flat\(\)\.map\(String\)/, 'Homepage reconciliation nesjednocuje obě množiny offer IDs.');
assert.match(homeSync, /Storage\.prototype\.setItem = function setItem/, 'Homepage bridge nemirroruje budoucí zápisy.');
assert.match(homeSync, /window\.addEventListener\('storage'/, 'Homepage nereaguje na změnu uložených nabídek v jiné kartě.');
assert.match(homeSync, /initial\.homeChanged/, 'Pozdní favorite bootstrap neumí rozpoznat, že home-v2 načetl starý stav.');
assert.match(homeSync, /location\.reload\(\)/, 'Po úvodní migraci homepage klíče chybí jednorázové obnovení home-v2 state.saved.');
assert.match(homeSync, /@supabase\/supabase-js@2/, 'Homepage produktové oblíbené nemají zajištěný Supabase auth klient.');

const personalizationUrl = homeSync.match(/script\.src = '([^']*product-personalization\.js\?v=[^']+)'/)?.[1] || '';
const productFavoritesUrl = homeSync.match(/script\.src = '([^']*home-product-favorites\.js\?v=[^']+)'/)?.[1] || '';
assert.match(personalizationUrl, /^assets\/product-personalization\.js\?v=[0-9-]+$/, 'Homepage nenačítá verzovaný sdílený účetní personalization runtime.');
assert.match(productFavoritesUrl, /^assets\/home-product-favorites\.js\?v=[0-9-]+$/, 'Homepage nenačítá verzovaný bridge nabídka → produkt.');
assert.match(homeSync, /document\.getElementById\('dealGrid'\)/, 'Produktové oblíbené se nesmí bootovat mimo homepage nabídky.');

assert.match(homeProduct, /select: 'id,product_id'/, 'Homepage bridge musí mapovat offer.id na product_id.');
assert.match(homeProduct, /status: 'eq\.published'/, 'Homepage bridge nesmí mapovat neveřejné/nepublikované nabídky.');
assert.match(homeProduct, /const offerToProduct = new Map\(\)/, 'Homepage bridge musí cachovat mapování a neopakovat stejné dotazy.');
assert.match(homeProduct, /data-favorite-product/, 'Homepage bridge musí vytvořit účetní favorite control.');
assert.match(homeProduct, /card\.dataset\.productId = productId/, 'Homepage karta musí po bezpečném mapování nést product_id.');
assert.match(homeProduct, /new MutationObserver\(queueRefresh\)/, 'Homepage bridge musí doplnit oblíbení i po filtrování nebo načtení dalších karet.');
assert.doesNotMatch(homeProduct, /from\(['"]product_favorites['"]\)|\/product_favorites/, 'Homepage bridge nesmí duplikovat účetní zápisy; ty patří sdílenému personalization runtime.');
assert.match(personalization, /from\('product_favorites'\)/, 'Sdílený personalization runtime musí ukládat produktové oblíbené do účtu.');
assert.match(personalization, /data-favorite-product/, 'Sdílený personalization runtime musí obsluhovat homepage favorite control.');

assert.match(storeRuntime, /function mergeFavoriteLists\(\.\.\.lists\)/, 'Store bridge nemá union helper.');
assert.match(storeRuntime, /const merged = mergeFavoriteLists\(parseFavoriteList\(homeRaw\), parseFavoriteList\(storeRaw\)\);/, 'Store reconciliation nesjednocuje oba historické klíče.');
assert.doesNotMatch(storeRuntime, /homeFavorites !== null \? homeFavorites : storeFavorites/, 'Store runtime se vrátil ke ztrátovému homepage-wins chování.');
assert.match(storeRuntime, /initial\.storeChanged/, 'Store feed neobnoví paměťový stav po úvodní opravě store klíče.');
assert.match(storeRuntime, /window\.addEventListener\('storage'/, 'Store stránka nereaguje na cross-tab změnu favorites.');
const storeListenerStart = storeRuntime.indexOf("window.addEventListener('storage'");
const storeListenerEnd = storeRuntime.indexOf('\n    });', storeListenerStart);
assert.ok(storeListenerStart >= 0 && storeListenerEnd > storeListenerStart, 'Store storage listener nejde ověřit.');
const storeListenerSource = storeRuntime.slice(storeListenerStart, storeListenerEnd);
assert.match(storeListenerSource, /event\.newValue === null/, 'Store cross-tab listener neumí přesné smazání.');
assert.match(storeListenerSource, /parseFavoriteList\(event\.newValue\)/, 'Store cross-tab listener nepřebírá přesnou novou hodnotu.');
assert.doesNotMatch(storeListenerSource, /reconcileFavoriteKeys\(\)/, 'Store cross-tab listener nesmí unionem znovu oživit vzdáleně smazanou nabídku.');

const rpcUrl = index.match(/assets\/rpc-request-dedupe\.js\?v=[0-9-]+/)?.[0] || '';
const homeUrl = index.match(/assets\/home-v2\.js\?v=[0-9-]+/)?.[0] || '';
const rpcIndex = rpcUrl ? index.indexOf(rpcUrl) : -1;
const homeIndex = homeUrl ? index.indexOf(homeUrl) : -1;
assert.ok(rpcIndex >= 0 && homeIndex > rpcIndex, 'Homepage bootstrap musí startovat před home-v2.js.');
assert.match(worker, /const CACHE_NAME = 'slevao-shell-[a-z0-9-]+';/i, 'PWA shell nemá platné verzované jméno cache.');
assert.ok(worker.includes(`'/${rpcUrl}'`), 'PWA shell necachuje stejný homepage bootstrap jako index.html.');
assert.ok(worker.includes(`'/${favoriteSyncUrl}'`), 'PWA shell necachuje stejný favorite sync runtime jako homepage bootstrap.');
assert.ok(worker.includes(`'/${productFavoritesUrl}'`), 'PWA shell necachuje stejný homepage product favorite bridge jako favorite sync runtime.');
assert.ok(worker.includes(`'/${personalizationUrl}'`), 'PWA shell necachuje stejný účetní personalization runtime jako favorite sync runtime.');

class StorageMock {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
}

function runBridge(initial = {}) {
  const localStorage = new StorageMock(initial);
  const sessionStorage = new StorageMock();
  const window = {
    localStorage,
    addEventListener() {},
    setTimeout(callback) { callback(); return 1; },
  };
  const context = {
    Storage: StorageMock,
    localStorage,
    sessionStorage,
    window,
    document: { getElementById() { return null; } },
    location: { reload() {} },
    JSON,
    Set,
    Array,
    String,
    Object,
  };
  new Script(homeSync, { filename:'favorite-offer-bridge-test.js' }).runInNewContext(context);
  return localStorage;
}

function runStoreBridge(initial = {}) {
  const prefixEnd = storeRuntime.indexOf("\n  if (!document.querySelector('link[href*=\"public-features.css\"]'))");
  assert.ok(prefixEnd > 0, 'Store favorite bootstrap nejde izolovaně behaviorálně otestovat.');
  const favoriteBootstrap = `${storeRuntime.slice(0, prefixEnd)}\n})();`;
  class StoreStorageMock {
    constructor(values = {}) { this.map = new Map(Object.entries(values)); }
    getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
    setItem(key, value) { this.map.set(String(key), String(value)); }
    removeItem(key) { this.map.delete(String(key)); }
  }
  const localStorage = new StoreStorageMock(initial);
  const sessionStorage = new StoreStorageMock();
  let storageListener = null;
  const window = {
    localStorage,
    addEventListener(type, callback) { if (type === 'storage') storageListener = callback; },
    setTimeout(callback) { callback(); return 1; },
  };
  const context = {
    Storage: StoreStorageMock,
    localStorage,
    sessionStorage,
    window,
    location: { reload() {} },
    JSON,
    Set,
    Array,
    String,
    Object,
  };
  new Script(favoriteBootstrap, { filename:'store-favorite-bridge-test.js' }).runInNewContext(context);
  assert.equal(typeof storageListener, 'function', 'Store bootstrap nezaregistroval storage listener.');
  return { localStorage, storageListener };
}

const HOME = 'slevao-saved';
const STORE = 'slevao-favorite-offers-v1';
const storage = runBridge({
  [HOME]: JSON.stringify(['A', 'A']),
  [STORE]: JSON.stringify(['B']),
});

assert.deepEqual(JSON.parse(storage.getItem(HOME)), ['A', 'B'], 'Homepage-only a store-only favorite se nesjednotily beze ztráty.');
assert.deepEqual(JSON.parse(storage.getItem(STORE)), ['A', 'B'], 'Store klíč po reconciliation neobsahuje union obou množin.');

storage.setItem(HOME, JSON.stringify(['A', 'C', 'C']));
assert.deepEqual(JSON.parse(storage.getItem(HOME)), ['A', 'C'], 'Homepage zápis se nenormalizoval/deduplikoval.');
assert.deepEqual(JSON.parse(storage.getItem(STORE)), ['A', 'C'], 'Homepage toggle se nepřenesl přesně do store klíče.');

storage.setItem(STORE, JSON.stringify(['C', 'D']));
assert.deepEqual(JSON.parse(storage.getItem(HOME)), ['C', 'D'], 'Store toggle se nepřenesl přesně do homepage klíče.');
assert.deepEqual(JSON.parse(storage.getItem(STORE)), ['C', 'D'], 'Store zápis se neočekávaně změnil.');

storage.removeItem(HOME);
assert.equal(storage.getItem(HOME), null, 'Homepage removeItem neodstranil homepage favorites.');
assert.equal(storage.getItem(STORE), null, 'Homepage removeItem neodstranil zrcadlený store favorites klíč.');

const storeBridge = runStoreBridge({
  [HOME]: JSON.stringify(['A', 'B']),
  [STORE]: JSON.stringify(['A', 'B']),
});
storeBridge.storageListener({
  storageArea: storeBridge.localStorage,
  key: HOME,
  newValue: JSON.stringify(['A']),
});
assert.deepEqual(JSON.parse(storeBridge.localStorage.getItem(HOME)), ['A'], 'Store cross-tab listener neaplikoval vzdálené odebrání z homepage klíče.');
assert.deepEqual(JSON.parse(storeBridge.localStorage.getItem(STORE)), ['A'], 'Store cross-tab listener unionem znovu oživil vzdáleně odebranou nabídku.');

console.log('Favorite offer reconciliation and homepage product favorites OK');
