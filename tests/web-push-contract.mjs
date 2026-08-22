import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const client = readFileSync(new URL('assets/web-push.js', root), 'utf8');
const edge = readFileSync(new URL('supabase/functions/web-push/index.ts', root), 'utf8');
const account = readFileSync(new URL('ucet.html', root), 'utf8');

assert.match(account, /assets\/web-push\.js\?v=20260822-2/, 'Účet musí načítat aktuální web-push runtime.');

assert.match(client, /const browserReady = Boolean\(sub && Notification\.permission === 'granted'\)/, 'Klient musí oddělit lokální browser subscription od serverového potvrzení.');
assert.match(client, /subscribed = result\?\.subscribed === true;/, 'Background sync smí hlásit aktivní stav jen po potvrzení serverem.');
assert.match(client, /result\?\.subscribed !== true \|\| result\?\.test_sent !== true/, 'Explicitní aktivace musí vyžadovat serverové potvrzení i testovací push.');
assert.match(client, /await removeSubscription\(sub\);/, 'Neúspěšná explicitní aktivace musí uklidit lokální i serverovou subscription.');
assert.match(client, /result\?\.requires_test/, 'Klient musí umět nabídnout opětovné potvrzení mrtvé subscription.');

assert.match(edge, /const sendTest = body\?\.send_test === true;/, 'Edge Function musí rozlišovat explicitní test od background synchronizace.');
assert.match(edge, /existing && existing\.is_active === false && !sendTest/, 'Background sync nesmí reaktivovat dříve deaktivovaný endpoint.');
assert.match(edge, /subscribed: false, requires_test: true/, 'Mrtvý endpoint musí vyžadovat nový explicitní test.');
assert.match(edge, /if \(!result\.sent\)/, 'Neúspěšný test musí mít explicitní větev.');
assert.match(edge, /update\(\{ is_active: false, updated_at:/, 'Neúspěšný test musí subscription ponechat neaktivní.');
assert.match(edge, /subscribed: false, test_sent: false, requires_test: true/, 'Neúspěšný test nesmí být reportován jako aktivní subscription.');

const testPos = edge.indexOf('if (sendTest)');
const capPos = edge.indexOf('await enforceSubscriptionCap', testPos);
assert.ok(testPos >= 0 && capPos > testPos, 'Limit zařízení se smí aplikovat až po úspěšném testu nové subscription.');

assert.match(edge, /isDirectPrivateOrLocalHost/, 'SSRF ochrana push endpointů musí zůstat zachovaná.');
assert.match(edge, /x-cron-secret/, 'Interní dispatch musí zůstat chráněný cron secretem.');
assert.match(edge, /alreadySent/, 'Dispatch musí zachovat idempotenci již doručených subscription.');

console.log('Web Push client/server activation contract OK');
