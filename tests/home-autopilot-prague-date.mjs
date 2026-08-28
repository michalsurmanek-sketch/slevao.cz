import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/home-autopilot.js', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(source, { filename:'assets/home-autopilot.js' });

assert.match(source, /const pragueDate = \(value = new Date\(\)\) => new Intl\.DateTimeFormat\('en-CA'/, 'Autopilot nemá čerstvý Prague date helper.');
assert.match(source, /timeZone:'Europe\/Prague'/, 'Autopilot datum není ukotvené na Europe/Prague.');
assert.match(source, /const today = pragueDate\(\);/, 'Offer dotaz nepoužívá čerstvý Prague den.');
assert.match(source, /\.gt\('price', 0\)/, 'Autopilot offer dotaz nevyřazuje nulové a záporné ceny na databázové vrstvě.');
assert.match(source, /Number\.isFinite\(price\) && price > 0/, 'Autopilot neověřuje kladnou konečnou cenu i na klientu.');
assert.match(source, /Number\.isFinite\(rawQuantity\) && rawQuantity > 0 \? Math\.max\(0\.01, rawQuantity\) : 1/, 'Autopilot nesanitizuje poškozené legacy množství.');
assert.doesNotMatch(source, /getFullYear\(\)|getMonth\(\)|getDate\(\)/, 'Autopilot znovu skládá den z timezone zařízení.');
assert.doesNotMatch(source, /toISOString\(\)\.slice\(0,\s*10\)/, 'Autopilot znovu používá UTC ISO den.');

const calculateStart = source.indexOf('  function calculate(rows, offers)');
const calculateEnd = source.indexOf('\n  function initialHtml(count)', calculateStart);
assert.ok(calculateStart >= 0 && calculateEnd > calculateStart, 'Autopilot calculate nejde izolovaně otestovat.');
const context = { Map, Set, String, Number, Math };
new Script(`${source.slice(calculateStart, calculateEnd)}\n
globalThis.metrics = calculate([
  { product_id:'a', quantity:2 },
  { product_id:'b', quantity:'Infinity' },
  { product_id:'c', quantity:'bad' },
], [
  { product_id:'a', price:10, old_price:12, store_id:'s1' },
  { product_id:'a', price:0, old_price:99, store_id:'s0' },
  { product_id:'b', price:'5', old_price:0, store_id:'s2' },
  { product_id:'c', price:-1, old_price:20, store_id:'s3' },
  { product_id:'c', price:'NaN', old_price:20, store_id:'s3' },
]);`, { filename:'home-autopilot-price-quantity-simulation.js' }).runInNewContext(context);
assert.equal(context.metrics.total, 25, 'Autopilot musí spočítat 2×10 + fallback 1×5 a ignorovat neplatné ceny.');
assert.equal(context.metrics.linked, 2, 'Nulová/záporná/nečíselná cena nesmí vytvořit oceněnou položku.');
assert.equal(context.metrics.missing, 1, 'Položka bez kladné ceny se musí počítat jako chybějící.');
assert.equal(context.metrics.savings, 4, 'Doložená úspora má vzniknout jen z platné ceny a vyšší old_price.');

const version = '20260822-1';
assert.match(index, new RegExp(`assets/home-autopilot\\.js\\?v=${version}`), 'Homepage nenačítá aktuální Prague-safe Autopilot.');
assert.ok(
  index.indexOf(`assets/home-autopilot.js?v=${version}`) < index.indexOf('assets/home-footer-redesign.js'),
  'Homepage musí načíst Autopilot před footerem, aby footer nevložil starou dynamickou verzi.'
);
assert.match(worker, new RegExp(`assets/home-autopilot\\.js\\?v=${version}`), 'PWA shell nemá aktuální Autopilot verzi.');

console.log('Homepage Autopilot Prague date, positive-price filtering and finite quantity safety OK');
