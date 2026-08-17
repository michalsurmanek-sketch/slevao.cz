import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-list.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-list.js' });

assert.match(source, /const SHARED_POLL_MS = 30000;/, 'Sdílený seznam nemá úsporný heartbeat interval.');
assert.match(source, /get_shared_shopping_list_revision/, 'Sdílený seznam nepoužívá lehký revision RPC.');
assert.match(source, /function productSignature\(/, 'Sdílený seznam neumí rozpoznat změnu produktové sady.');
assert.match(source, /productsChanged \|\| !activeOffers\.length/, 'Ceny se nenačítají podmíněně podle změny produktů.');
assert.match(source, /visibilitychange/, 'Sdílený seznam se neobnoví po návratu do záložky.');
assert.match(source, /window\.addEventListener\('focus'/, 'Sdílený seznam se neobnoví po návratu do okna.');
assert.doesNotMatch(source, /setInterval\([^\n]*loadSharedList[^\n]*5000/, 'Sdílený seznam znovu používá 5s full polling.');

console.log('Shared list revision sync OK');
