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
assert.doesNotMatch(source, /getFullYear\(\)|getMonth\(\)|getDate\(\)/, 'Autopilot znovu skládá den z timezone zařízení.');
assert.doesNotMatch(source, /toISOString\(\)\.slice\(0,\s*10\)/, 'Autopilot znovu používá UTC ISO den.');

const version = '20260822-1';
assert.match(index, new RegExp(`assets/home-autopilot\\.js\\?v=${version}`), 'Homepage nenačítá aktuální Prague-safe Autopilot.');
assert.ok(
  index.indexOf(`assets/home-autopilot.js?v=${version}`) < index.indexOf('assets/home-footer-redesign.js'),
  'Homepage musí načíst Autopilot před footerem, aby footer nevložil starou dynamickou verzi.'
);
assert.match(worker, new RegExp(`assets/home-autopilot\\.js\\?v=${version}`), 'PWA shell nemá aktuální Autopilot verzi.');

console.log('Homepage Autopilot Prague date OK');
