import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const list = read('assets/shopping-list.js');
const insights = read('assets/shopping-insights.js');
const html = read('seznam.html');
const serviceWorker = read('service-worker.js');

new Script(list, { filename:'assets/shopping-list.js' });
new Script(insights, { filename:'assets/shopping-insights.js' });
new Script(serviceWorker, { filename:'service-worker.js' });

for (const [name, source] of [['shopping-list', list], ['shopping-insights', insights]]) {
  assert.match(source, /function pragueDate\(value = new Date\(\)\)/, `${name} musí počítat čerstvý business day.`);
  assert.match(source, /timeZone:'Europe\/Prague'/, `${name} musí používat Europe/Prague.`);
  assert.match(source, /function addCalendarDays\(dateKey, days\)/, `${name} musí používat kalendářní posun dnů.`);
  assert.match(source, /Date\.UTC\(year, month - 1, day \+ Number\(days \|\| 0\)\)/, `${name} musí posouvat YYYY-MM-DD kalendářně.`);
  assert.doesNotMatch(source, /const today = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, `${name} nesmí zmrazit UTC dnešek při načtení skriptu.`);
  assert.doesNotMatch(source, /Date\.now\(\) \+ 7 \* 86400000/, `${name} nesmí používat pevný 24hodinový +7 offset přes DST.`);
}

assert.match(list, /async function fetchOffers\(\)[\s\S]*const today = pragueDate\(\);[\s\S]*const upcomingTo = addCalendarDays\(today, 7\);/, 'Nákupní seznam musí vytvářet čerstvé Prague +7 okno při každém fetchi nabídek.');
assert.match(list, /const eligible = source\.filter\(\(offer\) => !offer\.valid_to \|\| String\(offer\.valid_to\) >= today\);/, 'Optimizer musí i z existujícího snapshotu odfiltrovat již expirované nabídky.');
assert.match(list, /function calculatePlans\(\) \{\s*const today = pragueDate\(\);/, 'Jeden výpočet plánů musí používat jeden konzistentní čerstvý Prague den.');
assert.match(list, /const OFFER_REFRESH_MS = 5 \* 60 \* 1000;/, 'Nákupní seznam musí mít omezený stale interval pro ceny.');
assert.match(list, /function offersAreStale\(\)[\s\S]*pragueDate\(\) !== offerBusinessDay[\s\S]*Date\.now\(\) - lastOffersLoadedAt >= OFFER_REFRESH_MS/, 'Stale kontrola musí reagovat na změnu dne i stáří snapshotu.');
assert.match(list, /if \(offersLoading\) return offersLoading;/, 'Současné refresh požadavky cen musí sdílet jeden in-flight promise.');
assert.match(list, /visibilitychange[\s\S]*refreshOffersIfStale\(\)/, 'Po návratu do záložky se musí stale ceny obnovit.');
assert.match(list, /window\.addEventListener\('focus',[\s\S]*refreshOffersIfStale\(\)/, 'Po návratu do okna se musí stale ceny obnovit.');

assert.match(insights, /async function calculate\(\) \{\s*const today = pragueDate\(\);\s*const upcomingTo = addCalendarDays\(today, 7\);/, 'Shopping insights musí vytvářet čerstvé Prague +7 okno při každém přepočtu.');
assert.match(insights, /function chooseOffer\(offers, productId, today = pragueDate\(\)\)[\s\S]*String\(offer\.valid_to\) >= today/, 'Shopping insights nesmí vybrat expirovanou nabídku.');
assert.match(insights, /let lastBusinessDay = '';/, 'Shopping insights musí sledovat business day odděleně od localStorage signature.');
assert.match(insights, /current === lastSignature && businessDay === lastBusinessDay/, 'Nezměněný seznam smí přeskočit přepočet jen ve stejný Prague den.');
assert.match(insights, /lastBusinessDay = pragueDate\(\);/, 'Inicializace insights musí uložit den posledního úspěšného výpočtu.');

for (const asset of ['shopping-list.js', 'shopping-insights.js']) {
  const escaped = asset.replace('.', '\\.');
  const version = html.match(new RegExp(`assets/${escaped}\\?v=([0-9-]+)`))?.[1] || '';
  assert.ok(version, `seznam.html musí načítat verzovaný ${asset}.`);
  assert.ok(serviceWorker.includes(`'/assets/${asset}?v=${version}'`), `PWA musí cacheovat stejnou verzi ${asset} jako seznam.html.`);
}

console.log('Nákupní seznam: Prague/DST date window diagnostika prošla.');
