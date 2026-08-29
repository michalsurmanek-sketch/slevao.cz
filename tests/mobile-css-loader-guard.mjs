import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const navigation = fs.readFileSync('assets/mobile-navigation.js', 'utf8');
const leafletDirect = fs.readFileSync('assets/home-leaflet-direct.js', 'utf8');

assert.match(index, /href="assets\/mobile-ux\.css\?v=20260815-21"[^>]*data-mobile-ux-version="20260815-21"/, 'Homepage must load the canonical current mobile-ux stylesheet and matching marker.');
assert.match(navigation, /const mobileUxVersion = '20260815-21';/, 'mobile-navigation fallback must use the current canonical mobile UX version.');
assert.match(navigation, /querySelector\('link\[href\*="mobile-ux\.css"\]'\)/, 'mobile-navigation must detect any already-loaded mobile-ux stylesheet instead of a stale version marker.');
assert.doesNotMatch(navigation, /link\[data-mobile-ux-version=.*mobileUxVersion/, 'Legacy version-marker duplicate detection must not return.');
assert.doesNotMatch(leafletDirect, /canonicalMobileUx|20260809-8/, 'Temporary mobile CSS compatibility guard must be removed after the source loader fix.');
assert.match(index, /assets\/mobile-navigation\.js\?v=20260829-1/, 'Homepage must cache-bust the current mobile-navigation runtime.');
assert.match(index, /assets\/home-leaflet-direct\.js\?v=20260821-2/, 'Homepage must load the current cache-busted leaflet-direct runtime.');

console.log('mobile CSS loader single-source regression guard passed');
