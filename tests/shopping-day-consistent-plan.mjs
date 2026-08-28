import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-day-consistent-plan.js', root), 'utf8');
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
]) assert.ok(source.includes(needle), `Chybí day-consistent planner kontrakt: ${needle}`);

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

console.log('Day-consistent shopping planner OK');
