import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const css = readFileSync(new URL('assets/shopping-insights.css', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

const mobileStart = css.indexOf('@media(max-width:650px)');
assert.ok(mobileStart >= 0, 'Shopping insights CSS nemá mobilní breakpoint 650 px.');
const mobile = css.slice(mobileStart);

for (const needle of [
  '.sfHistoryGrid{grid-template-columns:1fr;gap:8px}',
  '.sfHistoryCard{padding:11px 12px;border-radius:14px}',
  '.sfHistoryCard h3{margin-bottom:2px;font-size:15px}',
  '.sfHistoryDate{font-size:11px}',
  '.sfHistoryTotal{align-items:center;margin:8px 0 5px}',
  '.sfHistoryTotal strong{font-size:20px}',
  '.sfHistorySaving{padding:3px 6px;font-size:10px}',
  '.sfHistoryMeta{font-size:12px;line-height:1.35}',
  '.sfHistoryActions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px;margin-top:8px}',
  '.sfHistoryActions .sfButton{min-height:34px;padding:0 9px}',
  '.sfHistoryEmpty{padding:18px}',
]) assert.ok(mobile.includes(needle), `Chybí mobilní history compact kontrakt: ${needle}`);

assert.ok(css.slice(0, mobileStart).includes('.sfHistoryGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}'), 'Desktop history grid byl nečekaně změněn.');
assert.ok(css.slice(0, mobileStart).includes('.sfHistoryCard{border:1px solid var(--sf-line,#dbe8e5);border-radius:17px;background:#fff;padding:15px}'), 'Desktop history card byl nečekaně změněn.');

const cssUrl = html.match(/assets\/shopping-insights\.css\?v=[^"']+/)?.[0] || '';
assert.equal(cssUrl, 'assets/shopping-insights.css?v=20260828-1', 'seznam.html nemá mobilní history CSS verzi 20260828-1.');
assert.ok(worker.includes(`'/${cssUrl}'`), 'PWA necachuje přesný shopping insights CSS ze seznam.html.');
const shellVersion = Number(worker.match(/const CACHE_NAME = 'slevao-shell-20260828-(\d+)';/)?.[1] || 0);
assert.ok(shellVersion >= 63, 'PWA shell se po mobilním history compact fixu musí posunout alespoň na 63.');

console.log('Shopping history is compact on mobile without changing desktop layout');
