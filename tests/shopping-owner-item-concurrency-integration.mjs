import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-owner-item-concurrency.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-owner-item-concurrency.js' });

const runtimeUrl = 'assets/shopping-owner-item-concurrency.js?v=20260828-1';
assert.ok(html.includes(runtimeUrl), 'seznam.html nenačítá owner item semantic CAS bridge.');
assert.ok(
  html.indexOf('assets/public-nav-upgrade.js?v=20260822-2') < html.indexOf(runtimeUrl),
  'Owner item CAS bridge běží před owner-scoped localStorage bridge.'
);
assert.ok(
  html.indexOf(runtimeUrl) < html.indexOf('assets/shopping-insights-bootstrap.js?v=20260828-6'),
  'Owner item CAS bridge musí obalit Supabase klienta před shopping runtime bootstrapem.'
);
assert.ok(worker.includes(`'/${runtimeUrl}'`), 'PWA necachuje owner item semantic CAS bridge.');
assert.match(worker, /const CACHE_NAME = 'slevao-shell-20260828-60';/, 'PWA shell nebyl po owner item CAS integraci posunut na verzi 60.');
assert.ok(source.includes("if (sharedMode || !document.querySelector('.sfListLayout')) return;"), 'CAS bridge není bezpečně vypnutý ve shared režimu.');
assert.ok(source.includes("if (String(table) !== 'shopping_list_items') return base;"), 'CAS bridge neomezuje Supabase proxy jen na shopping_list_items.');

console.log('Shopping owner item semantic CAS integration OK');
