import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-day-consistent-plan.js', root), 'utf8');
const insightGuard = readFileSync(new URL('assets/shopping-insights-validity-guard.js', root), 'utf8');
const mobileCss = readFileSync(new URL('assets/mobile-optimizer-compact.css', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-day-consistent-plan.js' });
new Script(insightGuard, { filename:'assets/shopping-insights-validity-guard.js' });

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
  'class="sfDayPlanDate"',
  'Platí společně ${esc(date)}',
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

for (const needle of [
  '#optimizer .sfDayPlanDate',
  '#optimizer .sfResultBox[data-day-consistent-plan="true"]',
  '"date date"',
  'grid-area:date;',
  'display:inline-flex;',
]) assert.ok(mobileCss.includes(needle), `Mobilní přesný plán neudrží datum viditelné: ${needle}`);

for (const needle of [
  "totalLabel.textContent !== '7denní odhad'",
  '7denní odhad může kombinovat ceny z různých dnů',
  'Dokončit nákup a uložit orientační odhad',
  'Uložená částka je plánovaný odhad nákupu, ne skutečná účtenka.',
  'function hasMixedTiming(text)',
  'function isSuccessHint(text)',
  'const RETRY_DELAYS = [4000, 10000, 20000];',
  'if (retryTimer || retryAttempts >= RETRY_DELAYS.length) return;',
  'if (sharedMode || !String(errorText || \'\').trim() || isSuccessHint(errorText)) return;',
  'refresh.click();',
  "complete.textContent = 'Dokončení čeká na přepočet';",
  "complete.textContent = 'Počítám odhad…';",
  'complete.disabled = true;',
  'if (success) clearRetryState();',
]) assert.ok(insightGuard.includes(needle), `Insights validity/retry guard nemá požadovanou ochranu: ${needle}`);

const statusStart = insightGuard.indexOf('  function normalizeText(text)');
const statusEnd = insightGuard.indexOf('\n  function clearRetryState()', statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart, 'Insights status funkce nejdou izolovaně otestovat.');
const timingContext = { String };
new Script(`${insightGuard.slice(statusStart, statusEnd)}
  globalThis.mixed = hasMixedTiming('1 položka používá akci začínající během příštích sedmi dnů.');
  globalThis.current = hasMixedTiming('Všechny položky mají nalezenou cenu.');
  globalThis.successCurrent = isSuccessHint('Všechny položky mají nalezenou cenu.');
  globalThis.successMissing = isSuccessHint('U 1 položky se nepodařilo najít platnou ani brzy začínající cenu.');
  globalThis.successUpcoming = isSuccessHint('2 položky používá akci začínající během příštích sedmi dnů.');
  globalThis.successEmptyList = isSuccessHint('Přidej položky do seznamu a odhad se vypočítá automaticky.');
  globalThis.errorFetch = isSuccessHint('Failed to fetch');
  globalThis.errorGeneric = isSuccessHint('Odhad nákupu se nepodařilo vypočítat.');
`, { filename:'shopping-insight-status-test.js' }).runInNewContext(timingContext);
assert.equal(timingContext.mixed, true, 'Budoucí akce se neoznačí jako mixed-date orientační odhad.');
assert.equal(timingContext.current, false, 'Čistě aktuální odhad se chybně označí jako mixed-date.');
assert.equal(timingContext.successCurrent, true, 'Úspěšný kompletní odhad není rozpoznán.');
assert.equal(timingContext.successMissing, true, 'Úspěšný částečný odhad s chybějící cenou není rozpoznán.');
assert.equal(timingContext.successUpcoming, true, 'Úspěšný odhad s budoucí akcí není rozpoznán.');
assert.equal(timingContext.successEmptyList, true, 'Prázdný seznam není rozpoznán jako validní stav.');
assert.equal(timingContext.errorFetch, false, 'Síťová chyba se nesmí vydávat za úspěšný odhad.');
assert.equal(timingContext.errorGeneric, false, 'Chyba výpočtu se nesmí vydávat za úspěšný odhad.');

const plannerUrl = html.match(/assets\/shopping-day-consistent-plan\.js\?v=[^"']+/)?.[0] || '';
const summaryUrl = html.match(/assets\/shopping-list-price-summary\.js\?v=[^"']+/)?.[0] || '';
const mobileCssUrl = html.match(/assets\/mobile-optimizer-compact\.css\?v=[^"']+/)?.[0] || '';
const insightGuardUrl = html.match(/assets\/shopping-insights-validity-guard\.js\?v=[^"']+/)?.[0] || '';
assert.match(plannerUrl, /^assets\/shopping-day-consistent-plan\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný day-consistent planner.');
assert.match(summaryUrl, /^assets\/shopping-list-price-summary\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný price summary.');
assert.match(mobileCssUrl, /^assets\/mobile-optimizer-compact\.css\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný mobilní optimizer CSS.');
assert.match(insightGuardUrl, /^assets\/shopping-insights-validity-guard\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá mixed-date insights guard.');
assert.ok(html.indexOf(plannerUrl) < html.indexOf(summaryUrl), 'Day-consistent planner se musí načíst před price-summary runtime.');
for (const runtimeUrl of [plannerUrl, summaryUrl, mobileCssUrl, insightGuardUrl]) {
  assert.ok(!worker.includes(`'/${runtimeUrl}'`), `${runtimeUrl} se nesmí vrátit do install-time PWA precache.`);
}
assert.ok(worker.includes("return /\\.(?:css|js|webmanifest)$/i.test(url.pathname);"), 'Planner, summary, optimizer CSS a validity guard musí být kritické runtime assety.');
assert.ok(worker.includes("cache: 'reload'"), 'Planner, summary, optimizer CSS a validity guard musí být network-first.');
assert.ok(worker.includes('putRuntime(request, response)'), 'Planner, summary, optimizer CSS a validity guard musí být po úspěšném načtení uložitelný do runtime cache.');

console.log('Day-consistent shopping planner, mixed-date insight semantics, bounded retry safety, mobile date visibility, refresh replay, failure-cache safety and runtime wiring OK');
