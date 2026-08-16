import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260816224500_public_offer_page.sql', import.meta.url), 'utf8');

assert.match(sql, /get_public_offer_page\s*\(/, 'Missing paginated public offer RPC.');
assert.match(sql, /least\(coalesce\(p_limit, 24\), 100\)/, 'Public page limit must be bounded.');
assert.match(sql, /greatest\(coalesce\(p_offset, 0\), 0\)/, 'Public page offset must be non-negative.');
assert.match(sql, /s\.is_active is true/, 'Public feed must exclude inactive stores.');
assert.match(sql, /o\.status = 'published'/, 'Public feed must include published offers only.');
assert.match(sql, /o\.is_verified is true/, 'Public feed must include verified offers only.');
assert.match(sql, /timezone\('Europe\/Prague', now\(\)\)/, 'Public feed must use Prague date boundaries.');
assert.match(sql, /row_number\(\) over/, 'Public feed must deduplicate before pagination.');
assert.match(sql, /count\(\*\) over \(\)::bigint as total_count/, 'Public feed must return authoritative total_count.');
assert.match(sql, /'description', description/, 'Public feed must preserve offer description used by cards.');
assert.match(sql, /security invoker/i, 'Public feed must remain SECURITY INVOKER.');
assert.match(sql, /grant execute .* to anon, authenticated, service_role/i, 'Public feed grants are incomplete.');

console.log('public-offer-page: ok');
