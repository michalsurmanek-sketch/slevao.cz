import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const guard = readFileSync(new URL('assets/account-notification-seen-guard.js', root), 'utf8');
const accountHtml = readFileSync(new URL('ucet.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(guard, { filename:'assets/account-notification-seen-guard.js' });

const guardVersion = '20260822-1';
assert.match(guard, /slevao-seen-live-notifications-v2:/, 'Seen cache není user-scoped.');
assert.match(guard, /slevao-active-user-v1/, 'Seen cache není navázaný na aktivní user ID.');
assert.match(guard, /window\.Notification\.permission !== 'granted'/, 'Seen cache se může zapsat i bez povolených browser notifikací.');
assert.ok(
  accountHtml.indexOf(`assets/account-notification-seen-guard.js?v=${guardVersion}`) < accountHtml.indexOf('assets/account.js?v='),
  'Seen guard musí být načtený před account.js.'
);
assert.match(worker, new RegExp(`assets/account-notification-seen-guard\\.js\\?v=${guardVersion}`), 'PWA shell necacheuje seen guard.');

class StorageMock {
  constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
}

const LEGACY = 'slevao-seen-live-notifications';
const ACTIVE = 'slevao-active-user-v1';
const USER_A = 'slevao-seen-live-notifications-v2:user-a';
const USER_B = 'slevao-seen-live-notifications-v2:user-b';
const localStorage = new StorageMock({ [LEGACY]: JSON.stringify(['legacy-notification']) });
const window = { localStorage, Notification:{ permission:'default' } };
const context = { Storage:StorageMock, window, String, JSON, Object };
new Script(guard, { filename:'account-notification-seen-guard-test.js' }).runInNewContext(context);

assert.equal(localStorage.getItem(LEGACY), null, 'Bez aktivního účtu nesmí být legacy seen cache čitelný.');
localStorage.setItem(ACTIVE, 'user-a');
assert.equal(localStorage.getItem(LEGACY), null, 'Globální legacy seen cache se nesmí připsat userovi A.');
localStorage.setItem(LEGACY, JSON.stringify(['a-blocked']));
assert.equal(localStorage.map.has(USER_A), false, 'Seen stav se zapsal ještě před povolením browser notifikací.');

window.Notification.permission = 'granted';
localStorage.setItem(LEGACY, JSON.stringify(['a-1']));
assert.deepEqual(JSON.parse(localStorage.map.get(USER_A)), ['a-1'], 'Povolená browser notifikace se neuložila do scope usera A.');
assert.deepEqual(JSON.parse(localStorage.getItem(LEGACY)), ['a-1'], 'User A nečte svůj vlastní seen stav.');

localStorage.setItem(ACTIVE, 'user-b');
assert.equal(localStorage.getItem(LEGACY), null, 'User B vidí seen stav usera A.');
localStorage.setItem(LEGACY, JSON.stringify(['b-1']));
assert.deepEqual(JSON.parse(localStorage.map.get(USER_B)), ['b-1'], 'Seen stav usera B se neuložil do jeho scope.');
assert.deepEqual(JSON.parse(localStorage.map.get(USER_A)), ['a-1'], 'Zápis usera B změnil seen stav usera A.');

localStorage.removeItem(LEGACY);
assert.equal(localStorage.map.has(USER_B), false, 'Mazání seen cache neodstranilo scope aktuálního usera B.');
assert.deepEqual(JSON.parse(localStorage.map.get(USER_A)), ['a-1'], 'Mazání usera B odstranilo seen stav usera A.');
assert.ok(localStorage.map.has(LEGACY), 'Karanténní legacy seen cache byl destruktivně smazán.');

localStorage.setItem(ACTIVE, 'user-a');
assert.deepEqual(JSON.parse(localStorage.getItem(LEGACY)), ['a-1'], 'Návrat usera A neobnovil jeho vlastní seen stav.');

console.log('Account notification seen scope OK');
