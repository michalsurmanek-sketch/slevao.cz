import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const account = readFileSync(new URL('assets/account.js', root), 'utf8');
const html = readFileSync(new URL('ucet.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(account, { filename:'assets/account.js' });

assert.match(account, /const action = event\.target\.closest\('\[data-toggle\],\[data-delete\]'\);/, 'Alert handler musí identifikovat konkrétní mutační tlačítko.');
assert.match(account, /if \(!row \|\| !action \|\| action\.disabled \|\| !userId\) return;\s*action\.disabled = true;/, 'Alert mutace musí blokovat dvojklik ještě před DB requestem.');
assert.match(account, /if \(action\.matches\('\[data-toggle\]'\)\)[\s\S]*?db\.from\('price_alerts'\)[\s\S]*?\.update\(/, 'Toggle hlídače musí běžet jen přes zamknuté action tlačítko.');
assert.match(account, /else if \(action\.matches\('\[data-delete\]'\)\)[\s\S]*?db\.from\('price_alerts'\)[\s\S]*?\.delete\(\)/, 'Delete hlídače musí běžet jen přes zamknuté action tlačítko.');
assert.match(account, /finally \{\s*if \(action\.isConnected\) action\.disabled = false;\s*\}/, 'Alert action se musí po chybě nebo neúplném refreshi znovu odemknout.');

assert.match(account, /\$\('markAllRead'\)\.addEventListener\('click',[\s\S]*?const button = \$\('markAllRead'\);/, 'Mark-all-read musí používat stabilní referenci tlačítka.');
assert.match(account, /if \(!session \|\| button\.disabled\) return;\s*button\.disabled = true;/, 'Mark-all-read musí blokovat paralelní kliknutí.');
assert.match(account, /try \{[\s\S]*?db\.from\('notifications'\)[\s\S]*?\.eq\('is_read', false\);[\s\S]*?if \(error\) throw error;/, 'Mark-all-read mutace musí převést DB error do catch větve.');
assert.match(account, /catch \(error\) \{\s*button\.disabled = false;[\s\S]*?Upozornění se nepodařilo označit jako přečtená/, 'Mark-all-read musí po chybě tlačítko odemknout a zobrazit chybu.');

const htmlVersion = html.match(/assets\/account\.js\?v=([0-9-]+)/)?.[1] || '';
assert.equal(htmlVersion, '20260822-3', 'ucet.html nemá aktuální account notification-delivery runtime.');
assert.ok(!worker.includes(`'/assets/account.js?v=${htmlVersion}'`), 'account.js se nesmí vrátit do install-time PWA precache.');
assert.ok(worker.includes("return /\\.(?:css|js|webmanifest)$/i.test(url.pathname);"), 'PWA musí account.js obsloužit jako kritický runtime asset.');
assert.ok(worker.includes("cache: 'reload'"), 'Account runtime musí být network-first s cache fallbackem.');

console.log('Account mutation button state OK');
