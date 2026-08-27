import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migrationPath = 'supabase/migrations/20260827215001_atomic_shopping_purchase_completion.sql';
const sql = readFileSync(new URL(migrationPath, root), 'utf8');

for (const needle of [
  'create or replace function public.validate_shopping_purchase_snapshot()',
  "if tg_op = 'INSERT'",
  'and new.shopping_list_id is not null',
  'and auth.uid() is not null',
  'if auth.uid() <> new.user_id then',
  'from public.shopping_lists sl',
  'sl.user_id = new.user_id',
  'sl.is_archived = false',
  'from public.shopping_list_items sli',
  'for update;',
  "sli.is_completed = false",
  'jsonb_agg(item_signature order by item_signature::text)',
  "'product_id'",
  "'custom_name'",
  "'quantity'",
  "'unit'",
  'from jsonb_array_elements(new.items) as item(value)',
  'if v_current_items <> v_purchase_items then',
  'v_atomic_completion := true;',
  "o.status = 'published'",
  'o.is_verified = true',
  'o.valid_from <= v_purchase_date',
  'o.valid_to >= v_purchase_date',
  'new.item_count := v_item_count;',
  'new.planned_total := round(greatest(v_planned, 0), 2);',
  'if v_atomic_completion then',
  'delete from public.shopping_list_items sli',
  'perform public.revoke_shopping_list_shares(new.shopping_list_id);',
]) {
  assert.ok(sql.includes(needle), `Chybí atomický completion kontrakt: ${needle}`);
}

const parentLock = sql.indexOf('from public.shopping_lists sl');
const childLock = sql.indexOf('from public.shopping_list_items sli', parentLock + 1);
const snapshotMismatch = sql.indexOf('if v_current_items <> v_purchase_items then');
const offerValidation = sql.indexOf('if exists (', snapshotMismatch + 1);
const totals = sql.indexOf('new.item_count := v_item_count;');
const cleanup = sql.indexOf('delete from public.shopping_list_items sli', totals + 1);
const revoke = sql.indexOf('perform public.revoke_shopping_list_shares(new.shopping_list_id);', cleanup + 1);
const returnNew = sql.lastIndexOf('return new;');

assert.ok(parentLock >= 0 && childLock > parentLock, 'Child řádky se zamykají před rodičem nebo rodičovský lock chybí.');
assert.ok(snapshotMismatch > childLock, 'Snapshot se porovnává před uzamčením všech řádků.');
assert.ok(offerValidation > snapshotMismatch, 'Validace nabídky musí proběhnout po uzamčení a snapshot kontrole.');
assert.ok(totals > offerValidation, 'Finanční součty se přepisují před validací nabídek.');
assert.ok(cleanup > totals, 'Seznam se maže dřív, než je validovaný a přepočítaný purchase snapshot.');
assert.ok(revoke > cleanup, 'Share odkazy se revokují před atomickým vyčištěním seznamu.');
assert.ok(returnNew > revoke, 'Trigger vrací NEW před dokončením atomického cleanupu.');

const atomicBlockStart = sql.indexOf("if tg_op = 'INSERT'");
const atomicFlag = sql.indexOf('v_atomic_completion := true;', atomicBlockStart);
assert.ok(atomicBlockStart >= 0 && atomicFlag > atomicBlockStart, 'INSERT guard neřídí atomické dokončení.');
assert.ok(!sql.includes("if tg_op = 'UPDATE'"), 'UPDATE historie nesmí mít vlastní cleanup větev.');

// Canonical snapshot fields must be represented twice: once for current DB rows
// and once for purchase JSON. This catches accidental one-sided schema changes.
for (const field of ['product_id', 'custom_name', 'quantity', 'unit']) {
  const matches = sql.match(new RegExp(`'${field}'`, 'g')) || [];
  assert.ok(matches.length >= 2, `Pole ${field} není kanonizované na obou stranách snapshotu.`);
}

console.log('Atomic shopping purchase completion migration contract OK');
