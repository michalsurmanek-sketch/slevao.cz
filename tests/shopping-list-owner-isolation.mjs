import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const nav = readFileSync(new URL('assets/public-nav-upgrade.js', root), 'utf8');
const account = readFileSync(new URL('assets/account.js', root), 'utf8');
const storeBottomNav = readFileSync(new URL('assets/store-bottom-nav.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');
const product = readFileSync(new URL('produkt.html', root), 'utf8');
const listHtml = readFileSync(new URL('seznam.html', root), 'utf8');
const accountHtml = readFileSync(new URL('ucet.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
const consumers = [
  'assets/public-features.js',
  'assets/home-autopilot.js',
  'assets/location-service.js',
  'assets/shopping-list.js',
  'assets/shopping-insights.js'
].map((path) => [path, readFileSync(new URL(path, root), 'utf8')]);

new Script(nav, { filename:'assets/public-nav-upgrade.js' });
new Script(account, { filename:'assets/account.js' });
new Script(storeBottomNav, { filename:'assets/store-bottom-nav.js' });

assert.match(nav, /const LEGACY_LIST_KEY = 'slevao-shopping-list-v1';/, 'Bridge nehlídá legacy shopping-list klíč.');
assert.match(nav, /const LIST_KEY_PREFIX = 'slevao-shopping-list-v2:';/, 'Bridge nemá owner-scoped v2 prefix.');
assert.match(nav, /const ACTIVE_USER_KEY = 'slevao-active-user-v1';/, 'Bridge nemá aktivní user marker.');
assert.match(nav, /legacyRows\.some\(\(row\) => row\?\.server_id\)/, 'Legacy synchronizovaný cache není karanténně chráněný.');
assert.match(nav, /delete copy\.server_id;/, 'Guest claim může přenést cizí server_id.');
assert.match(nav, /existing\.quantity = Math\.max\(/, 'Guest claim není idempotentní pro množství.');
assert.match(nav, /Storage\.prototype\.getItem = function getItem/, 'Legacy čtení není bridgované.');
assert.match(nav, /Storage\.prototype\.setItem = function setItem/, 'Legacy zápis není bridgované.');
assert.match(nav, /Storage\.prototype\.removeItem = function removeItem/, 'Legacy mazání není bridgované.');
assert.ok(nav.indexOf('installShoppingListOwnerBridge();') < nav.indexOf('loadLocationService();'), 'Owner bridge musí vzniknout před location/list consumery.');

assert.match(account, /function setListOwner\(userId\)/, 'Account runtime nespravuje shopping-list owner marker.');
assert.match(account, /setListOwner\(userId \|\| null\);/, 'applySession nenastavuje owner podle aktuální session.');
assert.match(account, /setListOwner\(session\?\.user\?\.id \|\| null\);/, 'Token\/user refresh neudržuje owner marker.');

for (const [path, source] of consumers) {
  assert.match(source, /slevao-shopping-list-v1/, `${path} už nepoužívá jednotný bridgovaný legacy klíč.`);
}

const navVersion = '20260901-2';
assert.match(index, new RegExp(`assets/public-nav-upgrade\\.js\\?v=${navVersion}`), 'index.html nemá nasazený owner bridge.');
for (const [name, source] of [['produkt.html', product], ['seznam.html', listHtml], ['ucet.html', accountHtml]]) {
  assert.match(source, new RegExp(`assets/public-nav-upgrade\\.js\\?v=${navVersion}`), `${name} nemá nasazený owner bridge.`);
}
for (const [name, source] of [['produkt.html', product], ['seznam.html', listHtml], ['ucet.html', accountHtml]]) {
  assert.ok(
    source.indexOf(`assets/public-nav-upgrade.js?v=${navVersion}`) < source.indexOf('assets/public-features.js'),
    `${name} musí nainstalovat owner bridge před prvním public-features čtením.`
  );
}
assert.match(storeBottomNav, new RegExp(`assets/public-nav-upgrade\\.js\\?v=${navVersion}`), 'Store loader nemá aktuální owner bridge.');
assert.ok(storeBottomNav.indexOf(`public-nav-upgrade.js?v=${navVersion}`) < storeBottomNav.indexOf('public-features.js?v=20260828-2'), 'Store loader musí vložit bridge před public-features.');
assert.match(storeBottomNav, /navScript\.async = false;/, 'Store public-nav loader nemá vynucené pořadí.');
assert.match(storeBottomNav, /script\.async = false;/, 'Store public-features loader nemá vynucené pořadí.');
const accountVersion = accountHtml.match(/assets\/account\.js\?v=([0-9-]+)/)?.[1] || '';
assert.ok(accountVersion, 'Účet nenačítá verzovaný owner-aware account runtime.');

// Owner bridge/account runtime are now cached after successful use. Verify the
// generic runtime contract instead of requiring them in install-time precache.
assert.match(worker, /function isLocalStatic\(request, url\)/, 'PWA nemá runtime cache pro owner-aware assety.');
assert.match(worker, /url\.pathname\.startsWith\('\/assets\/'\)/, 'PWA runtime neobsluhuje owner bridge\/account assety.');
assert.match(worker, /await cache\.put\(request, response\.clone\(\)\)/, 'PWA neukládá přesnou verzovanou owner-aware URL.');

const bridgeStart = nav.indexOf('  function installShoppingListOwnerBridge()');
const bridgeEnd = nav.indexOf('\n  function loadPersonalization()', bridgeStart);
assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart, 'Owner bridge nejde izolovaně otestovat.');
const bridgeFunction = nav.slice(bridgeStart, bridgeEnd);

function runBridge(initial = {}) {
  class StorageMock {
    constructor(values = {}) { this.map = new Map(Object.entries(values)); }
    getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
    setItem(key, value) { this.map.set(String(key), String(value)); }
    removeItem(key) { this.map.delete(String(key)); }
  }

  const localStorage = new StorageMock(initial);
  const context = {
    Storage: StorageMock,
    window: { localStorage },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    JSON, String, Number, Boolean, Math, Date, Map, Array, Object
  };
  const source = `
    const LEGACY_LIST_KEY = 'slevao-shopping-list-v1';
    const LIST_KEY_PREFIX = 'slevao-shopping-list-v2:';
    const ACTIVE_USER_KEY = 'slevao-active-user-v1';
    ${bridgeFunction}
    installShoppingListOwnerBridge();
  `;
  new Script(source, { filename:'shopping-list-owner-bridge-test.js' }).runInNewContext(context);
  return localStorage;
}

const LEGACY = 'slevao-shopping-list-v1';
const ACTIVE = 'slevao-active-user-v1';
const guestKey = 'slevao-shopping-list-v2:guest';
const userAKey = 'slevao-shopping-list-v2:user:user-a';
const userBKey = 'slevao-shopping-list-v2:user:user-b';

const storage = runBridge();
storage.setItem(LEGACY, JSON.stringify([{ product_id:'milk', quantity:2, completed:false }]));
assert.equal(JSON.parse(storage.map.get(guestKey))[0].product_id, 'milk', 'Guest zápis nejde do guest scope.');
storage.setItem(ACTIVE, 'user-a');
assert.equal(storage.map.has(guestKey), false, 'Guest cache po claimu zůstává veřejně dostupný.');
assert.equal(JSON.parse(storage.map.get(userAKey))[0].product_id, 'milk', 'Guest seznam nebyl převzat userem A.');
storage.setItem(LEGACY, JSON.stringify([{ product_id:'milk', quantity:3 }, { product_id:'bread', quantity:1 }]));
storage.removeItem(ACTIVE);
assert.equal(storage.getItem(LEGACY), null, 'Po odhlášení je stále vidět seznam usera A.');
storage.setItem(LEGACY, JSON.stringify([{ product_id:'eggs', quantity:1 }]));
storage.setItem(ACTIVE, 'user-b');
const userBRows = JSON.parse(storage.map.get(userBKey));
assert.deepEqual(userBRows.map((row) => row.product_id), ['eggs'], 'User B převzal položky usera A.');
assert.deepEqual(JSON.parse(storage.map.get(userAKey)).map((row) => row.product_id), ['milk', 'bread'], 'Přihlášení usera B změnilo cache usera A.');
storage.removeItem(ACTIVE);
storage.setItem(ACTIVE, 'user-a');
assert.deepEqual(JSON.parse(storage.getItem(LEGACY)).map((row) => row.product_id), ['milk', 'bread'], 'Návrat usera A neobnovil jeho vlastní seznam.');

const quarantined = runBridge({
  [LEGACY]: JSON.stringify([{ product_id:'secret', server_id:'server-row-id', quantity:1 }])
});
assert.equal(quarantined.map.has(guestKey), false, 'Synchronizovaný legacy cache se chybně migroval do guest scope.');
assert.equal(quarantined.getItem(LEGACY), null, 'Karanténní synchronizovaný cache je přes bridge čitelný.');
assert.ok(quarantined.map.has(LEGACY), 'Karanténní legacy data byla destruktivně smazána.');

const migrated = runBridge({
  [LEGACY]: JSON.stringify([{ product_id:'anonymous', quantity:1 }])
});
assert.equal(migrated.map.has(LEGACY), false, 'Anonymní legacy cache nebyla po migraci uklizena.');
assert.equal(JSON.parse(migrated.map.get(guestKey))[0].product_id, 'anonymous', 'Anonymní legacy cache nebyla bezpečně migrována.');

console.log('Shopping list owner isolation OK');