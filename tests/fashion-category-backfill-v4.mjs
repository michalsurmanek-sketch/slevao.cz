import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260818144152_classify_pure_fashion_retailers_v4.sql', import.meta.url), 'utf8');

assert.match(sql, /where slug = 'moda'/, 'Fashion backfill must resolve category by slug, not a hardcoded UUID.');
assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i, 'Fashion backfill must not hardcode category UUIDs.');
for (const slug of ['cropp','reserved','house','takko']) {
  assert.match(sql, new RegExp(`'${slug}'`), `Missing pure-fashion retailer ${slug}.`);
}
assert.match(sql, /p\.category_id is null/, 'Backfill must only fill previously unclassified products.');
assert.match(sql, /filter_group = 'fashion'/, 'Backfill must set canonical fashion filter group.');
assert.match(sql, /filter_tags = array\['moda'\]/, 'Backfill must set canonical moda tag.');
assert.match(sql, /classification_confidence = 0\.990/, 'Backfill must retain high-confidence marker.');
assert.match(sql, /classification_source = 'store-segment-v4'/, 'Backfill must be versioned.');
assert.match(sql, /refresh materialized view private\.public_offer_search_cache/, 'Public offer cache must be refreshed after classification.');

console.log('Fashion category backfill v4 OK');
