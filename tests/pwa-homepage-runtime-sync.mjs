import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const index = readFileSync(new URL('index.html', root), 'utf8');
const leaflets = readFileSync(new URL('letaky.html', root), 'utf8');
const list = readFileSync(new URL('seznam.html', root), 'utf8');
const product = readFileSync(new URL('produkt.html', root), 'utf8');
const account = readFileSync(new URL('ucet.html', root), 'utf8');
const footer = readFileSync(new URL('assets/home-footer-redesign.js', root), 'utf8');
const rpcBootstrap = readFileSync(new URL('assets/rpc-request-dedupe.js', root), 'utf8');
const pwaInstall = readFileSync(new URL('assets/pwa-install.js', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

const versionedAssets = (source) => [...new Set(
  [...source.matchAll(/assets\/([a-zA-Z0-9._-]+\.(?:css|js))\?v=([0-9-]+)/g)]
    .map((match) => `/assets/${match[1]}?v=${match[2]}`)
)];

// Keep this inventory only as a regression signal. Public runtime assets must
// no longer be copied into the install-time precache; the fetch handler caches
// them after a successful request.
const publicRuntimeAssets = new Set([
  ...versionedAssets(index),
  ...versionedAssets(leaflets),
  ...versionedAssets(list),
  ...versionedAssets(product),
  ...versionedAssets(account),
  ...versionedAssets(footer),
  ...versionedAssets(rpcBootstrap),
]);
assert.ok(publicRuntimeAssets.size > 0, 'Veřejné stránky nemají žádné verzované runtime assety k ověření.');

const versionsFor = (source, asset) => versionedAssets(source)
  .filter((value) => value.startsWith(`/assets/${asset}?v=`))
  .map((value) => value.split('?v=')[1]);
const productPersonalization = versionsFor(product, 'product-personalization.css');
const accountPersonalization = versionsFor(account, 'product-personalization.css');
assert.equal(productPersonalization.length, 1, 'Produkt musí načítat právě jednu verzi product-personalization.css.');
assert.equal(accountPersonalization.length, 1, 'Účet musí načítat právě jednu verzi product-personalization.css.');
assert.equal(productPersonalization[0], accountPersonalization[0], 'Produkt a účet musí používat stejnou verzi product-personalization.css.');

assert.match(worker, /const CACHE_VERSION = '20260901-5';/, 'Po změně cache strategie musí být zvýšená verze cache.');
assert.match(worker, /const CORE_CACHE_NAME = `slevao-core-\$\{CACHE_VERSION\}`;/, 'Service worker musí mít oddělenou core cache.');
assert.match(worker, /const RUNTIME_CACHE_NAME = `slevao-runtime-\$\{CACHE_VERSION\}`;/, 'Service worker musí mít oddělenou runtime cache.');
assert.match(worker, /const CORE_SHELL = \[\s*OFFLINE_URL,\s*'\/manifest\.webmanifest',\s*'\/favicon\.svg'\s*\];/s, 'Core shell má zůstat minimální a deterministický.');
assert.match(worker, /cache\.addAll\(CORE_SHELL\.map/, 'Instalace musí atomicky precachovat jen minimální core shell.');
assert.doesNotMatch(worker, /cache\.addAll\(SHELL\.map/, 'Instalace nesmí znovu používat starý monolitický SHELL precache.');
assert.doesNotMatch(worker, /cache\.addAll\([^\n]*RUNTIME/s, 'Instalace nesmí precachovat runtime assety jedním cache.addAll.');
assert.equal(versionedAssets(worker).length, 0, 'Service worker nesmí hardcodovat stovky verzovaných CSS/JS souborů do install-time shellu.');
assert.match(worker, /putRuntime\(request, response\)/, 'Úspěšné runtime odpovědi se musí ukládat až při použití.');
assert.match(worker, /isCriticalStatic[\s\S]*cache: 'reload'/, 'Kritické CSS/JS musí zůstat network-first.');
assert.match(worker, /event\.waitUntil\(network\.then\(\(\) => undefined\)\)/, 'Nekritické statické soubory mají používat stale-while-revalidate.');
assert.match(worker, /name\.startsWith\('slevao-shell-'\)/, 'Aktivace musí uklidit i starou monolitickou shell cache.');

// Install prompt must earn the interruption instead of appearing on a first visit.
assert.match(pwaInstall, /eligible = visits >= 2;/, 'Instalační banner musí být automaticky způsobilý až od druhé návštěvy.');
assert.match(pwaInstall, /const PERMANENT_DISMISS_KEY = 'slevao-install-dismissed-permanently';/, 'PWA banner musí respektovat trvalé odmítnutí.');
assert.match(pwaInstall, /const CHOICE_COOLDOWN_MS = 30 \* 24 \* 60 \* 60 \* 1000;/, 'Odmítnutí systémového dialogu musí mít dlouhý cooldown.');
assert.match(pwaInstall, /const SHOW_FREQUENCY_MS = 7 \* 24 \* 60 \* 60 \* 1000;/, 'Vlastní instalační banner musí mít frekvenční limit.');
assert.match(pwaInstall, /function verifySuccessfulListAddition\(button\)/, 'První návštěva musí rozlišovat dokončené přidání do seznamu od pouhého kliknutí.');
assert.match(pwaInstall, /classList\?\.contains\('is-added'\)/, 'Úspěšné přidání musí být ověřeno až podle dokončeného UI stavu.');
assert.match(pwaInstall, /document\.addEventListener\('slevao:successful-action', markSuccessfulAction\)/, 'PWA banner musí mít explicitní success event pro další dokončené akce.');
assert.doesNotMatch(pwaInstall, /#searchButton,[^\n]*markSuccessfulAction|#homeAutopilot button|#slLiveManual button/, 'Pouhé kliknutí na hlavní CTA nesmí zpřístupnit PWA banner při první návštěvě.');
assert.match(pwaInstall, /function isPrimaryExperienceVisible\(\)/, 'Banner musí kontrolovat kolizi s hlavní zkušeností stránky.');
assert.match(pwaInstall, /document\.querySelector\('\.heroCard'\)/, 'Banner nesmí překrýt hero CTA.');
assert.match(pwaInstall, /document\.getElementById\('homeAutopilot'\)/, 'Banner nesmí překrýt Nákupní autopilot.');
assert.match(pwaInstall, /safeSet\(localStorage, PERMANENT_DISMISS_KEY, '1'\)/, 'Křížek musí uložit trvalé odmítnutí.');

console.log(`PWA split-cache + deferred install prompt OK (${publicRuntimeAssets.size} page dependencies cached on demand)`);
