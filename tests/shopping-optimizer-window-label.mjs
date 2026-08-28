import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-optimizer-window-label.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-optimizer-window-label.js' });

for (const needle of [
  "const PREFIX = '7denní odhad · ';",
  'jednotlivé budoucí ceny nemusí platit ve stejný den',
  "normalized.includes('pouziva akci zacinajici')",
  "card.dataset.windowEstimate = upcoming ? 'true' : 'false';",
  "card?.dataset?.dayConsistentPlan === 'true'",
  "new MutationObserver(sync).observe(optimizer, { childList:true, subtree:true });",
]) assert.ok(source.includes(needle), `Chybí optimizer window-label kontrakt: ${needle}`);

const helperStart = source.indexOf('  function isUpcomingEstimate(text)');
const helperEnd = source.indexOf('\n  function syncCard(card)', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Window-label helper nejde izolovaně otestovat.');
const context = { String };
new Script(`${source.slice(helperStart, helperEnd)}\nglobalThis.future = isUpcomingEstimate('2 položky používá akci začínající během příštích 7 dnů.');\nglobalThis.current = isUpcomingEstimate('Všechny ceny jsou aktuálně platné.');`, { filename:'optimizer-window-helper.js' }).runInNewContext(context);
assert.equal(context.future, true, 'Budoucí cenová varianta se neoznačí jako 7denní odhad.');
assert.equal(context.current, false, 'Čistě aktuální varianta se chybně označí jako 7denní odhad.');

const guardUrl = html.match(/assets\/shopping-optimizer-window-label\.js\?v=[^"']+/)?.[0] || '';
assert.match(guardUrl, /^assets\/shopping-optimizer-window-label\.js\?v=20260828-[0-9]+$/, 'seznam.html nenačítá verzovaný optimizer window-label guard.');
assert.ok(worker.includes(`'/${guardUrl}'`), 'PWA necachuje přesný optimizer window-label guard ze seznam.html.');

console.log('Shopping optimizer clearly labels future mixed-window variants as 7-day estimates');
