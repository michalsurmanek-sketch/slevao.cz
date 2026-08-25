import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260825190000_penny_next_day_prefetch.sql', root), 'utf8');

assert.match(sql, /time zone 'Europe\/Prague'/, 'Penny rollover must use the Prague calendar date.');
assert.match(sql, /v_to\s*<\s*v_today\s+or\s+v_from\s*>\s*v_today\+1/i, 'Penny may accept only a current or next-day campaign.');
assert.match(sql, /valid_from<=v_to[\s\S]*valid_to>=v_from[\s\S]*not\(id=any\(v_offer_ids\)\)/, 'Penny expiration must be scoped to the incoming campaign overlap.');
assert.match(sql, /coalesce\(detected_valid_from,'-infinity'::date\)<=v_to[\s\S]*coalesce\(detected_valid_to,'infinity'::date\)>=v_from/, 'Penny import replacement must be scoped to overlapping campaign dates.');
assert.match(sql, /'prefetched_next_day',v_from>v_today/, 'Penny must record when a campaign was prefetched for tomorrow.');
assert.doesNotMatch(sql, /where store_id=v_store_id\s+and status='published'\s+and metadata->>'adapter'='penny-structured-html-v1'\s+and not\(id=any\(v_offer_ids\)\)/, 'Penny must never blanket-expire the still-valid current campaign.');
assert.doesNotMatch(sql, /if not \(v_from<=v_today and v_to>=v_today\)/, 'Penny must not reject an official campaign solely because it begins tomorrow.');

console.log('Penny next-day prefetch guard OK');
