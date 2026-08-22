import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const bootstrap = readFileSync(new URL('assets/rpc-request-dedupe.js', root), 'utf8');
const homeSync = readFileSync(new URL('assets/home-favorite-offer-sync.js', root), 'utf8');
const storeRuntime = readFileSync(new URL('assets/store-bottom-nav.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(bootstrap, { filename:'assets/rpc-request-dedupe.js' });
new Script(homeSync, { filename:'assets/home-favorite-offer-sync.js' });
new Script(storeRuntime, { filename:'assets/store-bottom-nav.js' });

assert.doesNotMatch(bootstrap, /localStorage|sessionStorage|setTimeout|setInterval/, 'Facets dedupe bootstrap nesmí znovu převzít persistentní Storage logiku.');
assert.match(bootstrap, /home-favorite-offer-sync\.js\?v=20260822-1/, 'Homepage bootstrap nenačítá oddělený favorite sync runtime.');
assert.match(bootstrap, /syncScript\.async = false;/, 'Favorite sync loader nemá stabilní ordered-script režim.');

assert.match(homeSync, /const HOME_FAVORITES_KEY = 'slevao-saved';/, 'Homepage bridge nehlídá homepage favorites klíč.');
assert.match(homeSync, /const STORE_FAVORITES_KEY = 'slevao-favorite-offers-v1';/, 'Homepage bridge nehlídá store favorites klíč.');
assert.match(homeSync, /function mergeFavoriteLists\(\.\.\.lists\)/, 'Homepage bridge nemá union helper.');
assert.match(homeSync, /available\.flat\(\)\.map\(String\)/, 'Homepage reconciliation nesjednocuje obě množiny offer IDs.');
assert.match(homeSync, /Storage\.prototype\.setItem = function setItem/, 'Homepage bridge nemirroruje budoucí zápisy.');
assert.match(homeSync, /window\.addEventListener\('storage'/, 'Homepage nereaguje na změnu uložených nabídek v jiné kartě.');
assert.match(homeSync, /initial\.homeChanged/, 'Pozdní favorite bootstrap neumí rozpoznat, že home-v2 načetl starý stav.');
assert.match(homeSync, /location\.reload\(\)/, 'Po úvodní migraci homepage klíče chybí jednorázové obnovení home-v2 state.saved.');

assert.match(storeRuntime, /function mergeFavoriteLists\(\.\.\.lists\)/, 'Store bridge nemá union helper.');
assert.match(storeRuntime, /const merged = mergeFavoriteLists\(parseFavoriteList\(homeRaw\), parseFavoriteList\(storeRaw\)\);/, 'Store reconciliation nesjednocuje oba historické klíče.');
assert.doesNotMatch(storeRuntime, /homeFavorites !== null \? homeFavorites : storeFavorites/, 'Store runtime se vrátil ke ztrátovému homepage-wins chování.');
assert.match(storeRuntime, /initial\.storeChanged/, 'Store feed neobnoví paměťový stav po úvodní opravě store klíče.');
assert.match(storeRuntime, /window\.addEventListener\('storage'/, 'Store stránka nereaguje na cross-tab změnu favorites.');

const rpcIndex = index.indexOf('assets/rpc-request-dedupe.js?v=20260819-1');
const homeIndex = index.indexOf('assets/home-v2.js?v=20260821-1');
assert.ok(rpcIndex >= 0 && homeIndex > rpcIndex, 'Homepage bootstrap musí startovat před home-v2.js.');
assert.match(worker, /const CACHE_NAME = 'slevao-shell-20260822-11';/, 'PWA shell nebyl po oddělení favorite bridge posunutý.');
assert.match(worker, /assets\/rpc-request-dedupe\.js\?v=20260819-1/, 'PWA shell necachuje homepage bootstrap.');
assert.match(worker, /assets\/home-favorite-offer-sync\.js\?v=20260822-1/, 'PWA shell necachuje favorite sync runtime.');

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

console.log('Favorite offer reconciliation OK');
