import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = 'supabase/migrations/20260825205041_flop_success_health_ok.sql';
assert.ok(fs.existsSync(path), 'FLOP success health migration is missing');
const sql = fs.readFileSync(path, 'utf8');

assert.ok(sql.includes("health_status='degraded'"));
assert.ok(sql.includes("health_status='ok'"));
assert.ok(sql.includes('v_target_count'));
assert.ok(sql.includes('matematicky ověřených FLOP TOP nabídek'));
assert.ok(!sql.includes('update public.offers'));
assert.ok(!sql.includes('delete from public.offers'));

console.log('FLOP success health classification regression checks passed');
