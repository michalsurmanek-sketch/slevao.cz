import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const account = read('assets/account.js');
const html = read('ucet.html');
const serviceWorker = read('service-worker.js');

new Script(account, { filename:'assets/account.js' });
new Script(serviceWorker, { filename:'service-worker.js' });

assert.doesNotMatch(account, /auth\.getSession\s*\(/, 'Účet nesmí mít druhou ruční getSession startup cestu vedle onAuthStateChange.');
assert.doesNotMatch(account, /function\s+renderSession\s*\(/, 'Účet nesmí vrátit starý paralelní renderSession lifecycle.');
assert.match(account, /let hydratedUserId = null;/, 'Účet musí pamatovat naposledy hydratované user ID.');
assert.match(account, /let authWork = Promise\.resolve\(\);/, 'Auth hydratace musí být serializovaná jedním promise řetězcem.');
assert.match(account, /function queueSessionApply\(nextSession\)/, 'Chybí jediná serializovaná vstupní cesta pro změnu session.');
assert.match(account, /const changed = hydratedUserId !== userId;/, 'Hydratace musí rozlišovat skutečnou změnu uživatele.');
assert.match(account, /if \(!changed\)[\s\S]*?return;/, 'Opakovaný auth event stejného uživatele musí skončit bez těžké hydratace.');

assert.match(account, /async function processPendingAlert\(userId\)/, 'Pending cenový hlídač musí být navázaný na konkrétní user ID.');
assert.match(account, /await processPendingAlert\(userId\);[\s\S]*await loadAccountData\(userId\);[\s\S]*hydratedUserId = userId;/, 'Pending hlídač a účetní data se musí zpracovat jen v nové-user hydrataci.');
assert.match(account, /String\(session\?\.user\?\.id \|\| ''\) !== String\(userId\)/, 'Asynchronní odpovědi musí ignorovat stale user session.');
assert.match(account, /function ensurePendingAlertRequestId\(pending\)/, 'Pending hlídač musí dostat stabilní request UUID.');
assert.match(account, /globalThis\.crypto\?\.randomUUID\?\.\(\)/, 'Pending hlídač musí generovat UUID před insertem.');
assert.match(account, /pending\.request_id = generated;[\s\S]*localStorage\.setItem\(PENDING_ALERT_KEY, JSON\.stringify\(pending\)\)/, 'Request UUID musí být uloženo do pending storage před insertem.');
assert.match(account, /\.\.\.\(requestId \? \{ id:requestId \} : \{\}\)/, 'Insert musí znovu použít stabilní request UUID jako primary key.');
assert.match(account, /error\.code === '23505'[\s\S]*verifyPendingAlertRetry\(userId, pending, requestId\)/, 'Duplicate retry se smí přijmout jen po ověření vlastního odpovídajícího řádku.');
assert.match(account, /verifyPendingAlertRetry\(userId, pending, requestId\)[\s\S]*\.eq\('id', requestId\)[\s\S]*\.eq\('user_id', userId\)[\s\S]*\.eq\('product_id', pending\.product_id\)[\s\S]*\.eq\('target_price', Number\(pending\.target_price\)\)/, 'Retry ověření musí kontrolovat UUID, user, produkt a cílovou cenu.');

assert.match(account, /function subscribeNotifications\(userId\)/, 'Realtime notifikace musí být připoutané ke konkrétnímu user ID.');
assert.match(account, /filter: `user_id=eq\.\$\{userId\}`/, 'Realtime filtr musí používat pevné user ID subscription.');
assert.match(account, /window\.setInterval\(async \(\) => \{[\s\S]*String\(session\?\.user\?\.id \|\| ''\) !== String\(userId\)/, 'Polling nesmí pokračovat pro předchozího uživatele.');
assert.match(account, /async function stopNotifications\(\)/, 'Účet musí mít centrální teardown realtime/pollingu.');

assert.match(account, /\$\('alerts'\)\.addEventListener\('click',[\s\S]*?db\.from\('price_alerts'\)[\s\S]*?\.update\(\{ is_active: !active \}\)[\s\S]*?\.eq\('id', row\.dataset\.id\)[\s\S]*?\.eq\('user_id', userId\)/, 'Toggle cenového hlídače musí být omezen na aktuální user ID.');
assert.match(account, /\$\('alerts'\)\.addEventListener\('click',[\s\S]*?db\.from\('price_alerts'\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\('id', row\.dataset\.id\)[\s\S]*?\.eq\('user_id', userId\)/, 'Smazání cenového hlídače musí být omezené na aktuální user ID.');
assert.match(account, /\$\('notifications'\)\.addEventListener\('click',[\s\S]*?db\.from\('notifications'\)[\s\S]*?\.update\(\{ is_read: true \}\)[\s\S]*?\.eq\('id', row\.dataset\.notificationId\)[\s\S]*?\.eq\('user_id', userId\)/, 'Označení jedné notifikace musí být omezené na aktuální user ID.');

assert.match(account, /onAuthStateChange\(\(event, nextSession\) =>/, 'Účet musí být řízen Supabase auth eventy.');
for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT']) {
  assert.ok(account.includes(`event === '${event}'`), `Auth lifecycle musí obsloužit ${event}.`);
}
for (const event of ['TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY']) {
  assert.ok(account.includes(`event === '${event}'`), `Lehká auth větev musí obsloužit ${event}.`);
}
assert.match(account, /queueSessionApply\(event === 'SIGNED_OUT' \? null : nextSession\)/, 'Těžká hydratace musí vstupovat přes jedinou session frontu.');
assert.match(account, /pagehide[\s\S]*authSubscription\?\.unsubscribe\?\.\(\)[\s\S]*stopNotifications\(\)/, 'Při opuštění stránky se musí odpojit auth subscription i notifikace.');

const htmlVersion = html.match(/assets\/account\.js\?v=([0-9-]+)/)?.[1] || '';
assert.ok(htmlVersion, 'ucet.html musí načítat verzovaný account.js.');
assert.ok(!serviceWorker.includes(`'/assets/account.js?v=${htmlVersion}'`), 'account.js se nesmí vrátit do monolitického install-time PWA precache.');
assert.match(serviceWorker, /function isCriticalStatic\(url\)[\s\S]*\.(?:css\|js|css\|js\|webmanifest)/, 'Service worker musí rozpoznat účetní JavaScript jako kritický statický asset.');
assert.ok(serviceWorker.includes("cache: 'reload'"), 'Kritický account.js musí být network-first.');
assert.ok(serviceWorker.includes('putRuntime(request, response)'), 'Úspěšně načtený account.js musí být uložitelný do runtime cache.');

console.log('Účet: auth lifecycle regresní diagnostika prošla.');
