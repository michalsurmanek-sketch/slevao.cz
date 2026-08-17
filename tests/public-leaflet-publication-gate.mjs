import fs from 'node:fs';
import assert from 'node:assert/strict';

const feed = fs.readFileSync(new URL('../supabase/functions/store-leaflet-feed/index.ts', import.meta.url), 'utf8');
const document = fs.readFileSync(new URL('../supabase/functions/store-leaflet-document/index.ts', import.meta.url), 'utf8');

assert.match(feed, /\.eq\(['"]status['"],['"]published['"]\)/, 'Public leaflet feed must query published imports only.');
assert.doesNotMatch(feed, /\.in\(['"]status['"],\s*\[[^\]]*(?:review|publishing)/s, 'Public leaflet feed must never expose review/publishing imports.');
assert.match(document, /String\(job\.status\)!==['"]published['"]/, 'Public leaflet document endpoint must reject non-published imports.');
assert.doesNotMatch(document, /allowedStatuses[^\n]*(?:review|publishing)/, 'Public document endpoint must not whitelist review/publishing imports.');

console.log('public-leaflet-publication-gate: ok');
