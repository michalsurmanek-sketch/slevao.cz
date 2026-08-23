import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260823115640_fix_pro_doma_index_terminal_state.sql', 'utf8');

assert(migration.includes("v_msg := 'PRO-DOMA index timeout';"), 'PRO-DOMA index timeout must be an explicit terminal failure.');
assert(migration.includes("'PRO-DOMA index HTTP %s / length %s'"), 'PRO-DOMA invalid HTTP/index payload must remain a terminal failure.');
assert(migration.includes("v_msg := 'PRO-DOMA index neobsahuje eventy';"), 'PRO-DOMA empty index must remain a terminal failure.');

const stateReset = /set is_running=false,\s*run_started_at=null,\s*last_error=v_msg,\s*last_parser_error=v_msg,\s*health_status='error',\s*health_reason=v_msg,\s*updated_at=v_now/gu;
const resetCount = [...migration.matchAll(stateReset)].length;
assert.equal(resetCount, 3, 'Every PRO-DOMA index terminal failure must clear running state and persist an error.');

assert(migration.includes("security definer"), 'PRO-DOMA reconciler must preserve its privileged internal execution model.');
assert(migration.includes("set search_path to 'public', 'net', 'pg_temp'"), 'PRO-DOMA SECURITY DEFINER function must keep a fixed search_path.');
assert(migration.includes("status='completed'"), 'Successful PRO-DOMA index reconciliation must remain intact.');

console.log('PRO-DOMA index terminal state contract OK');
