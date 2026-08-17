import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260817154500_promote_fast_public_offer_search.sql', import.meta.url), 'utf8');

assert.match(sql, /search_public_offers\s*\(/, 'Missing public search RPC.');
assert.match(sql, /language plpgsql/i, 'Fast public search must use dynamic PL/pgSQL planning.');
assert.match(sql, /public\.unaccent\(coalesce\(p_query,''\)\)/, 'Search query must be accent-insensitive.');
assert.match(sql, /char_length\(v_q\) < 2/, 'Search must reject one-character queries.');
assert.match(sql, /v_q := left\(v_q,80\)/, 'Search query length must be bounded.');
assert.match(sql, /least\(coalesce\(p_limit,24\),100\)/, 'Search limit must be bounded.');
assert.match(sql, /greatest\(coalesce\(p_offset,0\),0\)/, 'Search offset must be non-negative.');
assert.match(sql, /s\.is_active is true/, 'Search must exclude inactive stores.');
assert.match(sql, /o\.status='published'/, 'Search must include published offers only.');
assert.match(sql, /o\.is_verified is true/, 'Search must include verified offers only.');
assert.match(sql, /timezone\('Europe\/Prague',now\(\)\)/, 'Search must use Prague date boundaries.');
assert.match(sql, /o\.normalized_title ilike/, 'Search must narrow candidates on indexed normalized titles.');
assert.match(sql, /o\.normalized_title %% %L/, 'Search must use trigram candidate lookup.');
assert.match(sql, /row_number\(\) over/, 'Search must deduplicate before ranking.');
assert.match(sql, /similarity\(d\.search_title,%L\)/, 'Search must use trigram similarity.');
assert.match(sql, /count\(\*\) over\(\)::bigint/, 'Search must return authoritative total_count.');
assert.match(sql, /return query execute v_sql/i, 'Search must execute a value-specialized query plan.');
assert.match(sql, /security invoker/i, 'Public search must remain SECURITY INVOKER.');
assert.match(sql, /grant execute .* to anon, authenticated, service_role/i, 'Public search grants are incomplete.');
assert.match(sql, /drop function if exists private\.search_public_offers_fast_test/i, 'Temporary private search implementation must be removed.');
assert.doesNotMatch(sql, /security definer/i, 'Public search must never be SECURITY DEFINER.');

console.log('public-offer-search: ok');
