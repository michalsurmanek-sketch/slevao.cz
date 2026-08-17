import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../assets/home-public-metrics.js', import.meta.url), 'utf8');
const search = fs.readFileSync(new URL('../assets/home-server-search.js', import.meta.url), 'utf8');

assert.match(source, /get_public_offer_metrics/, 'Homepage metrics must use the authoritative offer metrics RPC.');
assert.match(source, /get_public_store_facets/, 'Homepage store count must use public store facets.');
assert.match(source, /current_displayable/, 'Hero offer count must represent offers displayable today.');
assert.match(source, /p_include_upcoming:true/, 'Store facets must use the same public seven-day window.');
assert.match(source, /dataset\.authoritative = '1'/, 'Authoritative hero values must be marked explicitly.');
assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), 4000\)/, 'Metrics requests must have a client timeout.');
assert.match(source, /MutationObserver/, 'Authoritative values must survive local result-count rerenders.');
assert.match(search, /home-public-metrics\.js\?v=20260817-1/, 'Public metrics runtime must be loaded by the server search layer.');
assert.doesNotMatch(source, /innerHTML\s*=/, 'Metrics layer must not inject dynamic HTML.');

console.log('home-public-metrics: ok');
