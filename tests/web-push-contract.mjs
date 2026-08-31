import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const client = readFileSync(new URL('assets/web-push.js', root), 'utf8');
const pushWorker = readFileSync(new URL('push-service-worker.js', root), 'utf8');
const edge = readFileSync(new URL('supabase/functions/web-push/index.ts', root), 'utf8');
const account = readFileSync(new URL('ucet.html', root), 'utf8');
const accountRuntime = readFileSync(new URL('assets/account.js', root), 'utf8');

assert.match(account, /assets\/web-push\.js\?v=20260831-1&push=3/, 'Účet musí načítat aktuální Web Push runtime s fallbackem.');

assert.match(client, /const SW_URL = '\/push-service-worker\.js';/, 'Push musí primárně používat samostatný service worker bez závislosti na PWA precache.');
assert.match(client, /const SW_SCOPE = '\/push\/';/, 'Samostatný push worker musí používat oddělený scope.');
assert.match(client, /const ROOT_SW_URL = '\/service-worker\.js';/, 'Push aktivace musí mít fallback na hlavní service worker.');
assert.match(client, /const ROOT_SW_SCOPE = '\/';/, 'Fallback hlavního workeru musí používat root scope.');
assert.match(client, /async function ensureRegistration\(url, scope\)/, 'Registrace workeru musí používat sdílený bezpečný helper.');
assert.match(client, /return await ensureRegistration\(SW_URL, SW_SCOPE\);/, 'Primární aktivace musí nejdřív zkusit izolovaný push worker.');
assert.match(client, /return ensureRegistration\(ROOT_SW_URL, ROOT_SW_SCOPE\);/, 'Při selhání izolovaného workeru musí aktivace přejít na root worker.');
assert.match(client, /slevao_push_worker_fallback/, 'Fallback workeru musí být diagnostikovatelný v konzoli.');
assert.match(client, /waitForActiveRegistration/, 'Aktivační tok musí počkat na aktivní push worker bez navigator.serviceWorker.ready.');
assert.doesNotMatch(client, /navigator\.serviceWorker\.ready/, 'Push aktivace nesmí čekat na root PWA worker přes ready.');
assert.match(client, /await current\.update\(\)\.catch\(\(\) => \{\}\)/, 'Aktivační tok musí vynutit kontrolu aktualizace existujícího workeru.');
assert.match(client, /Notification\.permission !== 'granted'/, 'Automatická oprava nesmí sama vyvolávat permission prompt.');
assert.match(client, /if \(!sub\) sub = await createBrowserSubscription\(current\);/, 'Při již uděleném povolení musí účet umět automaticky obnovit chybějící browser subscription.');
assert.match(client, /async function activateServerSubscription\(current, sub\)/, 'Klient musí sdílet jeden serverově potvrzený aktivační tok.');
assert.match(client, /let result = await saveSubscription\(sub, false\);/, 'Aktivace musí uložit subscription bez závislosti na okamžitém testovacím pushi.');
assert.doesNotMatch(client, /saveSubscription\(sub, true\)/, 'Aktivace zařízení nesmí být podmíněná okamžitým testovacím push doručením.');
assert.match(client, /if \(result\?\.requires_test\)/, 'Klient musí rozpoznat starý neaktivní endpoint.');
assert.match(client, /await removeSubscription\(sub\);[\s\S]*sub = await createBrowserSubscription\(current\);[\s\S]*result = await saveSubscription\(sub, false\);/, 'Starý neaktivní endpoint se musí jednou recyklovat na čerstvou subscription bez testovací brány.');
assert.match(client, /subscribed = activated\.result\?\.subscribed === true;/, 'Background auto-repair smí hlásit aktivní stav jen po potvrzení serverem.');
assert.match(client, /Number\(error\?\.status \|\| 0\) === 409/, 'Automatické odstranění subscription při chybě smí být omezené na konflikt vlastnictví endpointu.');
assert.match(client, /result\?\.gone === true/, 'Definitivně zaniklý endpoint musí být možné bezpečně uklidit.');
assert.match(client, /event\.target\.closest\?\.\('#enableBrowserAlerts'\)/, 'Web Push runtime musí vlastnit kliknutí na aktivační tlačítko.');
assert.match(client, /event\.stopImmediatePropagation\(\)/, 'Aktivace push musí zastavit případné staré click handlery.');
assert.match(client, /enableFromUser\(\)/, 'Kliknutí musí vést přes plný serverově ověřený aktivační tok.');
assert.match(client, /document\.readyState === 'loading'/, 'Web Push boot musí fungovat i při již dokončeném DOMContentLoaded.');

assert.match(pushWorker, /self\.addEventListener\('push'/, 'Izolovaný worker musí zpracovávat push event.');
assert.match(pushWorker, /self\.registration\.showNotification/, 'Izolovaný worker musí zobrazit systémovou notifikaci.');
assert.match(pushWorker, /self\.addEventListener\('notificationclick'/, 'Izolovaný worker musí obsloužit kliknutí na notifikaci.');
assert.doesNotMatch(pushWorker, /cache\.addAll|caches\.open/, 'Push worker nesmí být závislý na precache statických assetů.');

assert.doesNotMatch(accountRuntime, /function updateBrowserAlertButton\(/, 'Account runtime už nesmí samostatně odvozovat stav push jen z Notification.permission.');
assert.doesNotMatch(accountRuntime, /\$\('enableBrowserAlerts'\)\?\.addEventListener/, 'Account runtime nesmí mít druhý click handler aktivačního tlačítka.');
assert.doesNotMatch(accountRuntime, /Notification\.requestPermission\(\)/, 'Account runtime nesmí obcházet serverově ověřený Web Push aktivační tok.');
assert.match(accountRuntime, /function deliverBrowserNotification\(row\)/, 'Foreground zobrazení už doručených DB notifikací musí zůstat zachované.');

assert.match(edge, /const sendTest = body\?\.send_test === true;/, 'Edge Function musí stále podporovat oddělený diagnostický testovací režim.');
assert.match(edge, /existing && existing\.is_active === false && !sendTest/, 'Background sync nesmí automaticky reaktivovat dříve deaktivovaný endpoint.');
assert.match(edge, /subscribed: false, requires_test: true/, 'Neaktivní endpoint musí klientovi umožnit řízenou obnovu.');
assert.match(edge, /if \(!result\.sent\)/, 'Diagnostický test musí mít explicitní větev pro selhání doručení.');
assert.match(edge, /update\(\{ is_active: false, updated_at:/, 'Selhaný diagnostický test musí subscription ponechat neaktivní.');
assert.match(edge, /subscribed: false, test_sent: false, requires_test: true/, 'Selhaný diagnostický test nesmí být reportován jako aktivní subscription.');

const testPos = edge.indexOf('if (sendTest)');
const capPos = edge.indexOf('await enforceSubscriptionCap', testPos);
assert.ok(testPos >= 0 && capPos > testPos, 'Limit zařízení se smí v diagnostickém testovacím toku aplikovat až po úspěšném testu nové subscription.');

assert.match(edge, /isDirectPrivateOrLocalHost/, 'SSRF ochrana push endpointů musí zůstat zachovaná.');
assert.match(edge, /x-cron-secret/, 'Interní dispatch musí zůstat chráněný cron secretem.');
assert.match(edge, /alreadySent/, 'Dispatch musí zachovat idempotenci již doručených subscription.');

console.log('Web Push client/server activation contract OK');
