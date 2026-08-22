import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const source = readFileSync(new URL('../assets/store-feed.js', import.meta.url), 'utf8');
new Script(source, { filename:'assets/store-feed.js' });

assert.match(source, /const pragueDateKey = \(value = new Date\(\)\) => new Intl\.DateTimeFormat\('en-CA', \{/, 'Store feed nemá Prague date helper.');
assert.match(source, /timeZone:'Europe\/Prague'/, 'Store feed Prague date helper nemá explicitní Europe/Prague timezone.');
assert.match(source, /const today = pragueDateKey\(\);/, 'Store offer filtr nepoužívá Prague date helper.');
assert.doesNotMatch(source, /const today = new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/, 'Store feed se vrátil k UTC kalendářnímu dni.');

const loadStart = source.indexOf('  async function load()');
const todayPos = source.indexOf('const today = pragueDateKey();');
assert.ok(loadStart >= 0 && todayPos > loadStart, 'Prague den musí vznikat uvnitř každého load(), ne jednou při startu modulu.');

const helperStart = source.indexOf('  const pragueDateKey =');
const helperEnd = source.indexOf('\n\n  let offers', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Prague date helper nejde izolovaně behaviorálně otestovat.');
const helper = source.slice(helperStart, helperEnd);

function dateKey(iso) {
  const context = { Intl, Date, result:null };
  new Script(`${helper}\nresult = pragueDateKey(new Date(${JSON.stringify(iso)}));`, { filename:'store-prague-date-test.js' }).runInNewContext(context);
  return context.result;
}

assert.equal(dateKey('2026-08-21T22:30:00.000Z'), '2026-08-22', 'V létě musí store feed po pražské půlnoci použít nový den, i když UTC je ještě předchozí.');
assert.equal(dateKey('2026-01-01T23:30:00.000Z'), '2026-01-02', 'V zimě musí store feed respektovat CET hranici dne.');
assert.equal(dateKey('2026-08-22T21:30:00.000Z'), '2026-08-22', 'Před pražskou půlnocí nesmí store feed přeskočit na další den podle UTC/zařízení.');

console.log('Store feed Prague date OK');
