import fs from 'node:fs';

const path = 'supabase/functions/store-leaflet-feed/index.ts';
if (!fs.existsSync(path)) throw new Error(`Missing ${path}`);
const source = fs.readFileSync(path, 'utf8');

if (!source.includes('get_public_current_leaflets')) {
  throw new Error('store-leaflet-feed must keep the canonical aggregate RPC as its primary path.');
}

const legacy = "li.status in ('published','review','publishing')";
if (source.includes(legacy)) {
  throw new Error('Fallback leaflet feed must not expose review/publishing imports.');
}

const publishedOnlyMatches = source.match(/li\.status\s*=\s*'published'/g) || [];
if (publishedOnlyMatches.length < 2) {
  throw new Error(`Expected at least two published-only fallback predicates, got ${publishedOnlyMatches.length}.`);
}

for (const forbidden of [
  /li\.status\s+in\s*\([^)]*review/i,
  /li\.status\s+in\s*\([^)]*publishing/i,
  /status\s*=\s*'review'/i,
  /status\s*=\s*'publishing'/i,
]) {
  if (forbidden.test(source)) throw new Error(`Public fallback contains non-published status: ${forbidden}`);
}

for (const needle of [
  'detected_valid_to',
  'stores',
  'is_active',
]) {
  if (!source.includes(needle)) throw new Error(`Existing fallback visibility guard disappeared: ${needle}`);
}

console.log('store-leaflet-feed: published-only fallback boundary OK');
