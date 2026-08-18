import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const navigation = fs.readFileSync('assets/mobile-navigation.js', 'utf8');

assert.match(index, /href="assets\/mobile-ux\.css\?v=20260815-21"/, 'Homepage must load the canonical mobile-ux stylesheet.');
assert.match(navigation, /querySelector\(['"`]link\[href\*=[\\"']mobile-ux\.css[\\"']\]['"`]\)/, 'mobile-navigation must detect any already loaded mobile-ux stylesheet, independent of cache-buster metadata.');
assert.doesNotMatch(navigation, /link\[data-mobile-ux-version=.*mobileUxVersion/, 'mobile-navigation must not decide duplicate loading from a stale internal version marker.');

console.log('mobile CSS single-source guard passed');
