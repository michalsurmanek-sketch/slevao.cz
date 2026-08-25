import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'supabase/migrations/20260825201606_guard_jip_future_source_cleanup.sql';
assert.ok(fs.existsSync(path), 'JIP cleanup guard migration is missing');
const sql = fs.readFileSync(path, 'utf8');

assert.ok(sql.includes("'jip-flip-pdf-v1'"));
assert.ok(sql.includes("'expired_by_source_at'"));
assert.ok(sql.includes('new.detected_valid_to < old.detected_valid_from'));
assert.ok(sql.includes("new.status := 'ignored'"));
assert.ok(sql.includes('new.detected_valid_to := old.detected_valid_to'));
assert.ok(sql.includes('trg_guard_jip_future_source_cleanup'));

console.log('JIP future cleanup guard regression checks passed');
