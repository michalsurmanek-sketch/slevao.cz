import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-day-consistent-plan.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-day-consistent-plan.js' });

for (const needle of [
  'function validOn(offer, dateKey)',
  '(!from || from <= dateKey) && (!to || to >= dateKey)',
  'function cheapestOnDate(offers, dateKey)',
  'function planForDate(rows, offerLists, dateKey)',
  'if (!offer) return null;',
  'function bestDayPlan(rows, offerLists, today)',
  'for (let offset = 0; offset <= 7; offset++)',
  "box.dataset.dayConsistentPlan = 'true';",
  '<h3>Nejlevnější nákup v jeden den</h3>',
  'Všechny uvedené ceny platí současně',
  "db.rpc('get_shared_shopping_list', { p_token:sharedToken })",
  "db.rpc('get_public_shopping_list_candidates', { p_queries:customQueries, p_limit_per_query:30 })",
  ".lte('valid_from', upcomingTo)",
  ".gte('valid_to', today)",
  'let rerunRequested = false;',
  'rerunRequested = true;',
  'function commitResult(signature, html)',
  'function clearFailedResult()',
  "commitResult(signature, '');",
  "clearFailedResult();",
]) assert.ok(source.includes(needle), `Chybí day-consistent planner kontrakt: ${needle}`);

const refreshStart = source.indexOf('  async function refresh(');
const scheduleStart = source.indexOf('\n  function schedule()', refreshStart);
assert.ok(refreshStart >= 0 && scheduleStart > refreshStart, 'Planner refresh funkci nejde izolovaně ověřit.');
const refreshSource = source.slice(refreshStart, scheduleStart);
const guardIndex = refreshSource.indexOf('if (refreshing) {');
const requestIndex = refreshSource.indexOf('rerunRequested = true;', guardIndex);
const fetchIndex = refreshSource.indexOf('await fetchOfferLists(activeRows, today)');
const successCommitIndex = refreshSource.indexOf('commitResult(signature, plan ? planHtml', fetchIndex);
const catchIndex = refreshSource.indexOf('catch (error) {');
const clearFailureIndex = refreshSource.indexOf('clearFailedResult();', catchIndex);
const finallyIndex = refreshSource.indexOf('finally {');
const replayIndex = refreshSource.indexOf('if (rerunRequested) {', finallyIndex);
const scheduleIndex = refreshSource.indexOf('schedule();', replayIndex);
assert.ok(guardIndex >= 0 && requestIndex > guardIndex, 'Změna během běžícího planneru nepožádá o další refresh.');
assert.ok(fetchIndex > 0 && successCommitIndex > fetchIndex, 'Úspěšný síťový výsledek se neukládá až po načtení cen.');
assert.ok(!refreshSource.slice(0, fetchIndex).includes('lastRefreshAt = Date.now();'), 'Planner označí síťový refresh jako čerstvý ještě před načtením cen.');
assert.ok(!refreshSource.slice(0, fetchIndex).includes('lastSignature = signature;'), 'Planner cachuje podpis řádků ještě před úspěšným načtením cen.');
assert.ok(catchIndex >= 0 && clearFailureIndex > catchIndex, 'Selhání planneru neodstraní stale přesnou kartu a cache.');
assert.ok(finallyIndex >= 0 && replayIndex > finallyIndex && scheduleIndex > replayIndex, 'Po dokončení planneru se zahozená změna znovu nepřepočítá.');

const clearStart = source.indexOf('  function clearFailedResult()');
const clearEnd = source.indexOf('\n  async function refresh(', clearStart);
const clearSource = source.slice(clearStart, clearEnd);
for (const needle of ["lastSignature = '';", 'lastRefreshAt = 0;', "lastHtml = '';", "renderCard('');"]) {
  assert.ok(clearSource.includes(needle), `Failure cleanup nečistí stale stav: ${needle}`);
}

const validStart = source.indexOf('  function validOn(');
const validEnd = source.indexOf('\n  async function readRows()', validStart);
assert.ok(validStart >= 0 && validEnd > validStart, 'Planner pure functions nejdou izolovaně otestovat.');
const pure = source.slice(validStart, validEnd);
const context = { Number, String, Math, Date };
new Script(`
  function addCalendarDays(dateKey, days) {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    if (!year || !month || !day) return String(dateKey || '');
    return new Date(Date.UTC(year, month - 1, day + Number(days || 0))).toISOString().slice(0, 10);
  }
  ${pure}
  const rows = [
    { key:'a', quantity:1 },
    { key:'b', quantity:1 },
  ];
  const mixedTrap = new Map([
    ['a', [
      { price:10, valid_from:'2026-08-28', valid_to:'2026-08-28' },
      { price:12, valid_from:'2026-08-29', valid_to:'2026-08-29' },
    ]],
    ['b', [
      { price:20, valid_from:'2026-08-29', valid_to:'2026-08-29' },
    ]],
  ]);
  globalThis.plan = bestDayPlan(rows, mixedTrap, '2026-08-28');
  const impossible = new Map([
    ['a', [{ price:10, valid_from:'2026-08-28', valid_to:'2026-08-28' }]],
    ['b', [{ price:20, valid_from:'2026-08-29', valid_to:'2026-08-29' }]],
  ]);
  globalThis.none = bestDayPlan(rows, impossible, '2026-08-28');
  const quantityRows = [{ key:'q', quantity:3 }];
  globalThis.quantityPlan = bestDayPlan(quantityRows, new Map([['q',[{ price:7, valid_from:'2026-08-28', valid_to:'2026-09-04' }]]]), '2026-08-28');
`, { filename:'day-consistent-planner-simulation.js' }).runInNewContext(context);

assert.equal(context.plan?.dateKey, '2026-08-29', 'Planner zkombinoval ceny z různých dnů místo společného dne.');
assert.equal(context.plan?.total, 32, 'Day-consistent cena má být 12 + 20 = 32, ne smíšených 10 + 20 = 30.');
assert.equal(context.none, null, 'Planner vytvořil košík, i když nabídky nemají žádný společný den.');
assert.equal(context.quantityPlan?.total, 21, 'Planner nenásobí cenu skutečným množstvím.');

const plannerUrl = html.match(/assets\/shopping-day-consistent-plan\.js\?v=[^"']+/)?.[0] || '';
const summaryUrl = html.match(/assets\/shopping-list-price-summary\.js\?v=[^"']+/)?.[0] || '';
assert.match(plannerUrl, /^assets\/shopping-day-consistent-plan\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný day-consistent planner.');
assert.match(summaryUrl, /^assets\/shopping-list-price-summary\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný price summary.');
assert.ok(html.indexOf(plannerUrl) < html.indexOf(summaryUrl), 'Day-consistent planner se musí načíst před price-summary runtime.');
assert.ok(worker.includes(`'/${plannerUrl}'`), 'PWA necachuje přesný day-consistent planner ze seznam.html.');
assert.ok(worker.includes(`'/${summaryUrl}'`), 'PWA necachuje přesný price-summary runtime ze seznam.html.');

console.log('Day-consistent shopping planner, refresh replay, failure-cache safety and runtime wiring OK');
