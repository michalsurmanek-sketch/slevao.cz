import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const index = readFileSync(new URL('index.html', root), 'utf8');
const footer = readFileSync(new URL('assets/home-footer-redesign.js', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const extract = (source, pattern, label) => {
  const match = source.match(pattern);
  assert.ok(match?.[1], `Chybí verzovaná URL pro ${label}.`);
  return match[1];
};

const autopilotJs = extract(index, /assets\/home-autopilot\.js\?v=([0-9-]+)/, 'home-autopilot.js');
const leafletPositionJs = extract(index, /assets\/mobile-leaflet-nav-position\.js\?v=([0-9-]+)/, 'mobile-leaflet-nav-position.js');
const autopilotCss = extract(footer, /assets\/home-autopilot\.css\?v=([0-9-]+)/, 'home-autopilot.css');

assert.match(worker, new RegExp(`/assets/home-autopilot\\.js\\?v=${escape(autopilotJs)}`), 'PWA shell cachuje jinou verzi home-autopilot.js než homepage.');
assert.match(worker, new RegExp(`/assets/mobile-leaflet-nav-position\\.js\\?v=${escape(leafletPositionJs)}`), 'PWA shell cachuje jinou verzi mobile-leaflet-nav-position.js než homepage.');
assert.match(worker, new RegExp(`/assets/home-autopilot\\.css\\?v=${escape(autopilotCss)}`), 'PWA shell cachuje jinou verzi home-autopilot.css než homepage loader.');
assert.match(worker, /const CACHE_NAME = 'slevao-shell-20260830-2';/, 'Po změně precache runtime musí být zvýšený PWA cache namespace.');

console.log('PWA homepage runtime sync OK');
