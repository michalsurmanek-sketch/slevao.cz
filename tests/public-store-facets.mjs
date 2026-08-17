import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260817151000_add_public_store_facets_rpc.sql', import.meta.url), 'utf8');

assert.match(sql, /get_public_store_facets\s*\(/, 'Missing public store facets RPC.');
assert.match(sql, /security invoker/i, 'Store facets must remain SECURITY INVOKER.');
assert.match(sql, /s\.is_active is true/, 'Store facets must exclude inactive stores.');
assert.match(sql, /o\.status='published'/, 'Store facets must count published offers only.');
assert.match(sql, /o\.is_verified is true/, 'Store facets must count verified offers only.');
assert.match(sql, /timezone\('Europe\/Prague',now\(\)\)/, 'Store facets must use Prague date boundaries.');
assert.match(sql, /row_number\(\) over/, 'Store facets must deduplicate before counting.');
assert.match(sql, /count\(\*\) filter \(where d\.valid_from<=x\.today/, 'Store facets must expose current_count.');
assert.match(sql, /count\(\*\) filter \(where d\.valid_from>x\.today/, 'Store facets must expose upcoming_count.');
assert.match(sql, /grant execute .* to anon,authenticated,service_role/i, 'Store facet grants are incomplete.');
assert.doesNotMatch(sql, /security definer/i, 'Store facets must never be SECURITY DEFINER.');

console.log('public-store-facets: ok');
