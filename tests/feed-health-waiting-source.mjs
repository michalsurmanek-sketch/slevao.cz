import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260818083000_feed_health_waiting_source.sql', root), 'utf8');

assert.match(sql, /add column if not exists waiting_source boolean not null default false/i);
assert.match(sql, /health_status = 'waiting_source'/i);
assert.match(sql, /after insert or update or delete on public\.store_product_sync_state/i);
assert.match(sql, /when coalesce\(src\.waiting_source,false\) then 'temporarily-empty'/i);
assert.match(sql, /with \(security_invoker = true\)/i);
assert.doesNotMatch(sql, /waiting_source[^\n]+then 'broken-source'/i);

console.log('Feed-health waiting-source classification OK');
