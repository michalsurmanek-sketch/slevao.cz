import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../assets/home-server-search.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../assets/home-semantic-filters.js', import.meta.url), 'utf8');

assert.match(source, /search_public_offers/, 'Homepage suggestions must use the public search RPC.');
assert.match(source, /const MIN_QUERY = 2/, 'Search suggestions must ignore one-character queries.');
assert.match(source, /const MAX_QUERY = 80/, 'Search suggestions must bound query length.');
assert.match(source, /const LIMIT = 7/, 'Search suggestions must keep the result payload small.');
assert.match(source, /DEBOUNCE_MS = 180/, 'Search suggestions must debounce typing.');
assert.match(source, /setTimeout\(\(\) => controller\?\.abort\(\), 5000\)/, 'Search request must have a client timeout.');
assert.match(source, /event\.stopImmediatePropagation\(\)/, 'Server suggestions must replace the old local suggestion scan.');
assert.doesNotMatch(source, /innerHTML\s*=/, 'Server suggestion rendering must avoid dynamic innerHTML.');
assert.match(loader, /home-server-search\.js\?v=20260817-1/, 'Server suggestion runtime must be loaded by the homepage semantic layer.');

console.log('home-server-search: ok');
