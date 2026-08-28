import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const planner = readFileSync(new URL('assets/shopping-day-consistent-plan.js', root), 'utf8');
const summary = readFileSync(new URL('assets/shopping-list-price-summary.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(planner, { filename:'assets/shopping-day-consistent-plan.js' });
new Script(summary, { filename:'assets/shopping-list-price-summary.js' });

assert.ok(planner.includes('data-plan-date="${esc(plan.dateKey)}"'), 'Přesný plán nepředává strojově čitelné datum.');
assert.ok(summary.includes("box?.querySelector('.sfDayPlanDate[data-plan-date]')"), 'Cenový souhrn nečte datum přesného plánu.');
assert.ok(summary.includes("dateKey <= pragueDate()"), 'Budoucí plán se neporovnává s dnešním Prague dnem.');
assert.ok(summary.includes("futureTiming ? ` · ${futureTiming}`"), 'Celkem neupřednostní jasný popis budoucího společného dne.');
assert.ok(summary.includes("attributeFilter: ['title', 'data-plan-date']"), 'Souhrn nereaguje na změnu data přesného plánu.');

const start = summary.indexOf('  function futureDayLabel(');
const end = summary.indexOf('\n  function markUpcomingPlans()', start);
assert.ok(start >= 0 && end > start, 'futureDayLabel nejde izolovaně otestovat.');
const fn = summary.slice(start, end);

function evaluate(planDate, text, today) {
  const context = {
    String,
    RegExp,
    pragueDate: () => today,
    box: {
      querySelector(selector) {
        assert.equal(selector, '.sfDayPlanDate[data-plan-date]');
        return { dataset:{ planDate }, textContent:text };
      },
    },
  };
  new Script(`${fn}\nglobalThis.result = futureDayLabel(box);`, { filename:'future-day-label-test.js' }).runInNewContext(context);
  return context.result;
}

assert.equal(evaluate('2026-08-28', 'Platí společně 28. 8. 2026', '2026-08-28'), '', 'Dnešní přesný plán se nesmí označit jako budoucí.');
assert.equal(evaluate('2026-08-31', 'Platí společně 31. 8. 2026', '2026-08-28'), 'Platí společně 31. 8. 2026', 'Budoucí přesný plán nemá jasný časový kontext.');
assert.equal(evaluate('bad-date', 'Platí společně někdy', '2026-08-28'), '', 'Neplatné datum se nesmí vydávat za budoucí plán.');

const plannerUrl = html.match(/assets\/shopping-day-consistent-plan\.js\?v=[^"']+/)?.[0] || '';
const summaryUrl = html.match(/assets\/shopping-list-price-summary\.js\?v=[^"']+/)?.[0] || '';
assert.match(plannerUrl, /^assets\/shopping-day-consistent-plan\.js\?v=20260828-[0-9]+$/, 'HTML nenačítá verzovaný přesný planner.');
assert.match(summaryUrl, /^assets\/shopping-list-price-summary\.js\?v=20260828-[0-9]+$/, 'HTML nenačítá verzovaný cenový souhrn.');
assert.ok(worker.includes(`'/${plannerUrl}'`), 'PWA nemá stejnou verzi přesného planneru jako HTML.');
assert.ok(worker.includes(`'/${summaryUrl}'`), 'PWA nemá stejnou verzi cenového souhrnu jako HTML.');

console.log('Future exact shopping plan is clearly labeled in list total');
