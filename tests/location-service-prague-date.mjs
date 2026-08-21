import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const locationService = read('assets/location-service.js');
const html = read('seznam.html');
const serviceWorker = read('service-worker.js');

new Script(locationService, { filename:'assets/location-service.js' });
new Script(serviceWorker, { filename:'service-worker.js' });

assert.match(locationService, /const pragueDate = \(value = new Date\(\)\) => new Intl\.DateTimeFormat\('en-CA'/, 'Location service musí počítat čerstvý business day.');
assert.match(locationService, /timeZone:'Europe\/Prague'/, 'Location service musí používat Europe/Prague.');
assert.doesNotMatch(locationService, /const TODAY = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, 'Location service nesmí zmrazit UTC den při načtení skriptu.');

assert.match(locationService, /async function fetchOffersForStores\([\s\S]*?const today = pragueDate\(\);[\s\S]*?valid_from: `lte\.\$\{today\}`,[\s\S]*?valid_to: `gte\.\$\{today\}`/, 'Nabídky obchodů poblíž musí používat čerstvý Prague den při každém fetchi.');
assert.match(locationService, /async function fetchOffersForList\([\s\S]*?const today = pragueDate\(\);[\s\S]*?valid_from: `lte\.\$\{today\}`,[\s\S]*?valid_to: `gte\.\$\{today\}`/, 'Nákupní seznam poblíž musí používat čerstvý Prague den při každém fetchi.');
assert.match(locationService, /get TODAY\(\) \{ return pragueDate\(\); \}/, 'Zpětně kompatibilní SlevaoLocation.TODAY musí být dynamický getter.');
assert.match(locationService, /window\.SlevaoLocation = \{[\s\S]*?pragueDate,/, 'Location API musí zveřejnit Prague date helper pro navazující runtime vrstvy.');

const version = html.match(/assets\/location-service\.js\?v=([0-9-]+)/)?.[1] || '';
assert.ok(version, 'seznam.html musí načítat verzovaný location-service.js.');
assert.ok(serviceWorker.includes(`'/assets/location-service.js?v=${version}'`), 'PWA musí cacheovat stejnou verzi location-service.js jako seznam.html.');

console.log('Location service: Prague date diagnostika prošla.');
