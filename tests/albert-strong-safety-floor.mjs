import assert from 'node:assert/strict';
import fs from 'node:fs';

const sync = fs.readFileSync('supabase/functions/sync-albert-products/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260823101900_lower_albert_strong_safe_floor_to_50.sql', 'utf8');

assert(sync.includes('const MIN_SAFE = 50;'), 'Albert Edge sync must use the canonical strong floor 50');
assert(!sync.includes('const MIN_SAFE = 80;'), 'Albert Edge sync must not restore the obsolete floor 80');
assert(sync.includes("const PUBLISHER = 'publish_albert_publitas_text_offers_v4_strong';"), 'Albert Edge sync must keep the strong-identity publisher');
assert(sync.includes("if (strength !== 'strong') continue;"), 'Albert parser must keep strong identity filtering');
assert(sync.includes('if (built.rows.length < MIN_SAFE || built.rows.length > MAX_SAFE)'), 'Albert Edge sync must remain fail-closed outside its safety range');
assert(sync.includes("BAD = /(?:AKČNÍ NABÍDKA"), 'Albert parser must keep application/banner exclusion guards');

assert(migration.includes("'if v_count < 80 then'"), 'Migration must guard the previous strong-wrapper floor before changing it');
assert(migration.includes("'if v_count < 50 then'"), 'Migration must set the strong-wrapper floor to 50');
assert(migration.includes("'if v_input_count < 50 then'"), 'Migration must set the inner input floor to 50');
assert(migration.includes("'if v_published<50 then'"), 'Migration must set the inner post-filter floor to 50');
assert(migration.includes("'bezpečnostní minimum je 50.'"), 'Migration messages must report the canonical floor 50');

console.log('Albert strong safety floor contract OK');
