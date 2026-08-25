import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260825180500_flop_next_day_prefetch_guard.sql', root), 'utf8');

assert.match(sql, /v_target_date date := v_today/, 'Flop trigger must keep an explicit target date.');
assert.match(sql, /v_current_count>=25[\s\S]*v_current_to[\s\S]*v_target_date:=v_today\+1/, 'Flop must prefetch tomorrow when the current verified set ends today.');
assert.match(sql, /effective_from<=v_target_date and effective_to>=v_target_date/, 'Flop must choose the PDF for the target date, not always today.');
assert.match(sql, /old\.valid_to>=v_today/, 'Flop expiration guard must preserve offers through their final valid Prague date.');
assert.match(sql, /new\.status:=old\.status/, 'Premature Flop expiration must be blocked fail-closed.');
assert.match(sql, /time zone 'Europe\/Prague'/, 'Flop rollover must use Prague calendar dates.');
assert.doesNotMatch(sql, /valid_to\s*<\s*v_target_date/, 'The migration must not expire the current set merely because a future set starts tomorrow.');

console.log('Flop next-day prefetch guard OK');
