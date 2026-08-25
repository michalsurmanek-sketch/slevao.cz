import assert from 'node:assert/strict';
import fs from 'node:fs';

const paths = [
  'supabase/migrations/20260825203602_pro_doma_assets_index_details.sql',
  'supabase/migrations/20260825203631_pro_doma_assets_detail_retry.sql',
  'supabase/migrations/20260825204015_pro_doma_assets_cache_bypass.sql',
  'supabase/migrations/20260825204140_pro_doma_assets_parser_canonicalization.sql'
];

for (const path of paths) {
  assert.ok(fs.existsSync(path), `missing PRO-DOMA migration: ${path}`);
}

const indexSql = fs.readFileSync(paths[0], 'utf8');
const detailSql = fs.readFileSync(paths[1], 'utf8');
const cacheSql = fs.readFileSync(paths[2], 'utf8');
const parserSql = fs.readFileSync(paths[3], 'utf8');

assert.ok(indexSql.includes('assets.pro-doma.cz'));
assert.ok(indexSql.includes('fetch_url'));
assert.ok(indexSql.includes('detail_fetch_origin'));
assert.ok(detailSql.includes('v_fetch_url'));
assert.ok(detailSql.includes('assets.pro-doma.cz'));
assert.ok(cacheSql.includes('X-No-Cache'));
assert.ok(cacheSql.includes('Cache-Control'));
assert.ok(parserSql.includes('(?:www|assets)'));
assert.ok(parserSql.includes('pro-doma-jina-events-v2-assets'));
assert.ok(parserSql.includes("https://www.pro-doma.cz/"));
assert.ok(parserSql.includes('cp>0 and cp<=100000'));
assert.ok(parserSql.includes('vf<=vt'));

console.log('PRO-DOMA assets pipeline regression checks passed');
