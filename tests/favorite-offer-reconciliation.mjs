import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const homeRuntime = readFileSync(new URL('assets/rpc-request-dedupe.js', root), 'utf8');
const storeRuntime = readFileSync(new URL('assets/store-bottom-nav.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(homeRuntime, { filename:'assets/rpc-request-dedupe.js' });
new Script(storeRuntime, { filename:'assets/store-bottom-nav.js' });

assert.match(homeRuntime, /const HOME_FAVORITES_KEY = 'slevao-saved';/, 'Homepage bridge nehlídá homepage favorites klíč.');
assert.match(homeRuntime, /const STORE_FAVORITES_KEY = 'slevao-favorite-offers-v1';/, 'Homepage bridge nehlídá store favorites klíč.');
assert.match(homeRuntime, /function mergeFavoriteLists\(\.\.\.lists\)/, 'Homepage bridge nemá union helper.');
assert.match(homeRuntime, /available\.flat\(\)\.map\(String\)/, 'Homepage reconciliation nesjednocuje obě množiny offer IDs.');
assert.match(homeRuntime, /Storage\.prototype\.setItem = function setItem/, 'Homepage bridge nemirroruje budoucí zápisy.');
assert.match(homeRuntime, /window\.addEventListener\('storage'/, 'Homepage nereaguje na změnu uložených nabídek v jiné kartě.');

assert.match(storeRuntime, /function mergeFavoriteLists\(\.\.\.lists\)/, 'Store bridge nemá union helper.');
assert.match(storeRuntime, /const merged = mergeFavoriteLists\(parseFavoriteList\(homeRaw\), parseFavoriteList\(storeRaw\)\);/, 'Store reconciliation nesjednocuje oba historické klíče.');
assert.doesNotMatch(storeRuntime, /homeFavorites !== null \? homeFavorites : storeFavorites/, 'Store runtime se vrátil ke ztrátovému homepage-wins chování.');
assert.match(storeRuntime, /initial\.storeChanged/, 'Store feed neobnoví paměťový stav po úvodní opravě store klíče.');
assert.match(storeRuntime, /window\.addEventListener\('storage'/, 'Store stránka nereaguje na cross-tab změnu favorites.');

const rpcIndex = index.indexOf('assets/rpc-request-dedupe.js?v=20260819-1');
const homeIndex = index.indexOf('assets/home-v2.js?v=20260821-1');
assert.ok(rpcIndex >= 0 && homeIndex > rpcIndex, 'Favorite bridge musí běžet před vytvořením home-v2 state.saved.');
assert.match(worker, /const CACHE_NAME = 'slevao-shell-20260822-10';/, 'PWA shell nebyl po změně favorite bridge posunutý.');
assert.match(worker, /assets\/rpc-request-dedupe\.js\?v=20260819-1/, 'PWA shell necachuje první homepage runtime s favorite bridgem.');

const bridgeEnd = homeRuntime.indexOf('\n  if (window.__slevaoFacetsFetchDedupe) return;');
assert.ok(bridgeEnd > 0, 'Homepage favorite bridge nejde izolovaně behaviorálně otestovat.');
const favoriteBridge = `${homeRuntime.slice(0, bridgeEnd)}\n})();`;

class StorageMock {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
}

function runBridge(initial = {}) {
  const localStorage = new StorageMock(initial);
  const window = {
    localStorage,
    addEventListener() {},
    setTimeout(callback) { callback(); return 1; },
  };
  const context = {
    Storage: StorageMock,
    localStorage,
    window,
    location: { reload() {} },
    JSON,
    Set,
    Array,
    String,
    Object,
  };
  new Script(favoriteBridge, { filename:'favorite-offer-bridge-test.js' }).runInNewContext(context);
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
