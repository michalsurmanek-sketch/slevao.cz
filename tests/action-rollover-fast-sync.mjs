import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260825181500_action_rollover_fast_sync.sql', root), 'utf8');

assert.ok(sql.includes("time zone 'Europe/Prague'"));
assert.ok(sql.includes('v_current_count>=20'));
assert.ok(sql.includes("metadata->>'adapter'='action-html-v3'"));
assert.ok(sql.includes('product_count>=20'));
assert.ok(sql.includes("'*/15 * * * *'"));
assert.ok(!sql.includes("'25 3 * * *'"));

console.log('Action rollover fast sync OK');
