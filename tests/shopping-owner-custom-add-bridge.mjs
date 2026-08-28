import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const bridge = readFileSync(new URL('assets/shopping-owner-custom-add-bridge.js', root), 'utf8');
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');

assert.match(bridge, /const sharedMode = Boolean\(/, 'Bridge nepozná sdílený seznam.');
assert.match(bridge, /if \(sharedMode \|\| !document\.querySelector\('\.sfListLayout'\)\) return;/, 'Shared režim musí zůstat na původní cestě.');
assert.match(bridge, /await db\.auth\.getSession\(\)/, 'Bridge před owner RPC neověřuje session.');
assert.match(bridge, /if \(!session\?\.user\?\.id\)[\s\S]*forwardOriginal\(source\);/, 'Guest režim se nevrací k původnímu addCustom handleru.');
assert.match(bridge, /db\.rpc\('add_own_shopping_list_custom_item'/, 'Owner add nepoužívá atomický RPC.');
assert.match(bridge, /p_custom_name: name/, 'RPC nedostává název vlastní položky.');
assert.match(bridge, /p_quantity: quantity/, 'RPC nedostává přidávané množství.');
assert.match(bridge, /p_unit: 'ks'/, 'RPC nedostává jednotku.');
assert.match(bridge, /p_mutation_id: mutationId/, 'RPC nedostává idempotency mutation UUID.');
assert.match(bridge, /createMutationId\(\)/, 'Bridge nevytváří mutation UUID pro každý owner add.');
assert.match(bridge, /event\.stopImmediatePropagation\(\);[\s\S]*addOwnerCustom\('click'\);/, 'Owner click může propadnout do starého handleru.');
assert.match(bridge, /event\.key !== 'Enter'[\s\S]*event\.stopImmediatePropagation\(\);[\s\S]*addOwnerCustom\('enter'\);/, 'Owner Enter může propadnout do starého handleru.');
assert.match(bridge, /location\.reload\(\);/, 'Po atomickém zápisu se nenačte potvrzený cloudový stav.');
assert.ok(!bridge.includes("db.from('shopping_list_items')"), 'Bridge nesmí znovu zavádět přímý owner INSERT/UPDATE race.');

assert.match(bootstrap, /const OWNER_CUSTOM_ADD_URL = 'assets\/shopping-owner-custom-add-bridge\.js\?v=20260828-1';/, 'Bootstrap nemá verzovaný owner-add bridge.');
const bridgeLoad = bootstrap.indexOf('loadOwnerCustomAddBridge();');
const listLoad = bootstrap.indexOf('loadList();', bridgeLoad + 1);
assert.ok(bridgeLoad >= 0 && listLoad > bridgeLoad, 'Owner-add bridge se musí načíst před shopping-list.js.');

console.log('Atomic owner custom add bridge contract OK');
