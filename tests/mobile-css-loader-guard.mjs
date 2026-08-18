import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const navigation = fs.readFileSync('assets/mobile-navigation.js', 'utf8');
const leafletDirect = fs.readFileSync('assets/home-leaflet-direct.js', 'utf8');

assert.match(index, /href="assets\/mobile-ux\.css\?v=[^"]+"/, 'Homepage must load a canonical mobile-ux stylesheet.');

const directIndex = index.indexOf('assets/home-leaflet-direct.js');
const navigationIndex = index.indexOf('assets/mobile-navigation.js');
assert.ok(directIndex >= 0 && navigationIndex >= 0 && directIndex < navigationIndex,
  'home-leaflet-direct.js compatibility guard must execute before mobile-navigation.js while the legacy loader exists.');

const navigationDetectsAnyMobileUx = /querySelector\(['"`]link\[href\*=[^\n]*mobile-ux\.css/.test(navigation);
const compatibilityGuard = /canonicalMobileUx[\s\S]*dataset\.mobileUxVersion\s*=\s*['"]20260809-8['"]/.test(leafletDirect);

assert.ok(navigationDetectsAnyMobileUx || compatibilityGuard,
  'Duplicate mobile-ux loading is unguarded: either the navigation loader must detect any existing stylesheet or the compatibility guard must mark it before navigation runs.');

console.log('mobile CSS loader regression guard passed');
