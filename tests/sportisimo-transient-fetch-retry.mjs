import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260825203106_sportisimo_transient_fetch_retry.sql', 'utf8');

assert.match(sql, /retry_count',0/);
assert.match(sql, /v_retry < 2/);
assert.match(sql, /retry_scheduled/);
assert.match(sql, /retry_exhausted/);
assert.match(sql, /X-No-Cache','true'/);
assert.match(sql, /Cache-Control','no-cache'/);
assert.match(sql, /health_status='running'.*automatický retry/s);
assert.match(sql, /health_status='error'.*retry_exhausted/s);
assert.match(sql, /last_success_at=v_now/);
assert.match(sql, /last_offer_count=v_count/);
assert.match(sql, /last_published_count=v_count/);

console.log('Sportisimo transient retry guard OK');
