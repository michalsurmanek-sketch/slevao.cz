import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migrationPath = 'supabase/migrations/20260827215001_atomic_shopping_purchase_completion.sql';
const hardeningPath = 'supabase/migrations/20260828103919_require_list_for_authenticated_purchase_completion.sql';
const windowPath = 'supabase/migrations/20260828104148_align_purchase_history_with_seven_day_estimate.sql';
const financialPath = 'supabase/migrations/20260828123713_validate_shopping_purchase_financial_snapshot.sql';
const sql = readFileSync(new URL(migrationPath, root), 'utf8');
const hardeningSql = readFileSync(new URL(hardeningPath, root), 'utf8');
const windowSql = readFileSync(new URL(windowPath, root), 'utf8');
const financialSql = readFileSync(new URL(financialPath, root), 'utf8');

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

for (const field of ['product_id', 'custom_name', 'quantity', 'unit']) {
  const matches = sql.match(new RegExp(`'${field}'`, 'g')) || [];
  assert.ok(matches.length >= 2, `Pole ${field} není kanonizované na obou stranách původního snapshotu.`);
}

for (const needle of [
  'create or replace function public.validate_shopping_purchase_snapshot()',
  "if tg_op = 'INSERT'",
  'and auth.uid() is not null',
  'and new.shopping_list_id is null then',
  'Před dokončením nákupu se nepodařilo určit aktivní nákupní seznam.',
  'if v_atomic_completion then',
  'delete from public.shopping_list_items sli',
  'perform public.revoke_shopping_list_shares(new.shopping_list_id);',
]) {
  assert.ok(hardeningSql.includes(needle), `Chybí hardening completion kontrakt: ${needle}`);
}

const nullListGuard = hardeningSql.indexOf('and new.shopping_list_id is null then');
const normalAtomicGuard = hardeningSql.indexOf('and new.shopping_list_id is not null', nullListGuard + 1);
assert.ok(nullListGuard >= 0 && normalAtomicGuard > nullListGuard, 'Null-list ochrana musí předcházet atomickému completion bloku.');
assert.ok(!/alter\s+table\s+public\.shopping_list_purchases[\s\S]*shopping_list_id[\s\S]*not\s+null/i.test(hardeningSql), 'shopping_list_id nesmí být NOT NULL; historie používá FK ON DELETE SET NULL.');

for (const needle of [
  'v_purchase_window_end date :=',
  "::date + 7",
  'o.valid_from <= v_purchase_window_end',
  'o.valid_to >= v_purchase_date',
  "o.status = 'published'",
  'o.is_verified = true',
  "or o.product_id = (item.value->>'product_id')::uuid",
  "or abs(o.price - (item.value->>'price')::numeric) <= 0.01",
  'Historie obsahuje nabídku mimo povolený sedmidenní odhad nebo s nesouhlasící cenou.',
]) {
  assert.ok(windowSql.includes(needle), `Chybí sedmidenní purchase-history kontrakt: ${needle}`);
}
assert.ok(!windowSql.includes('o.valid_from <= v_purchase_date\n          and o.valid_to >= v_purchase_date'), 'Sedmidenní validace stále vyžaduje, aby každá uložená nabídka platila přesně v den dokončení.');
assert.ok(windowSql.includes('and new.shopping_list_id is null then'), 'Sedmidenní migrace ztratila null-list ochranu.');
assert.ok(windowSql.includes('if v_atomic_completion then'), 'Sedmidenní migrace ztratila atomický cleanup.');

for (const needle of [
  'create or replace function public.validate_shopping_purchase_snapshot()',
  "'custom_key', case when sli.product_id is null then sli.custom_key else null end",
  "'custom_key', case",
  'public.shopping_custom_name_key(coalesce(',
  'if v_current_items <> v_purchase_items then',
  'o.valid_from <= v_purchase_window_end',
  'o.valid_to >= v_purchase_date',
  "nullif(item.value->>'price', '') is not null",
  "abs(o.price - (item.value->>'price')::numeric) <= 0.01",
  "nullif(item.value->>'store_id', '') is not null",
  "o.store_id = (item.value->>'store_id')::uuid",
  "round(o.price * coalesce(nullif(item.value->>'quantity', '')::numeric, 1), 2)",
  "- (item.value->>'subtotal')::numeric",
  'greatest(coalesce(o.old_price, o.price), o.price)',
  "- (item.value->>'reference_subtotal')::numeric",
  'Historie obsahuje nabídku s neplatnou cenou, obchodem nebo mezisoučtem.',
  "where nullif(item.value->>'offer_id', '') is null",
  "or nullif(item.value->>'subtotal', '') is not null",
  "or nullif(item.value->>'reference_subtotal', '') is not null",
  'Neoceněná položka historie nesmí obsahovat cenu, obchod ani mezisoučet.',
  'count(distinct nullif(value->>\'store_id\', \'\'))::integer',
  'new.planned_total := round(greatest(v_planned, 0), 2);',
  'new.reference_total := round(greatest(v_reference, new.planned_total), 2);',
  'new.savings := round(greatest(new.reference_total - new.planned_total, 0), 2);',
  'delete from public.shopping_list_items sli',
  'perform public.revoke_shopping_list_shares(new.shopping_list_id);',
]) {
  assert.ok(financialSql.includes(needle), `Chybí finanční purchase-history kontrakt: ${needle}`);
}

assert.ok(!financialSql.includes("lower(btrim(coalesce(sli.custom_name, '')))"), 'Finální snapshot stále používá starou custom-name normalizaci místo custom_key.');
const financialSnapshotMismatch = financialSql.indexOf('if v_current_items <> v_purchase_items then');
const financialOfferValidation = financialSql.indexOf('if exists (', financialSnapshotMismatch + 1);
const unpricedValidation = financialSql.indexOf('Neoceněná položka historie nesmí obsahovat cenu, obchod ani mezisoučet.');
const financialTotals = financialSql.indexOf('new.item_count := v_item_count;');
const financialCleanup = financialSql.indexOf('delete from public.shopping_list_items sli', financialTotals + 1);
assert.ok(financialOfferValidation > financialSnapshotMismatch, 'Finanční nabídky se validují před snapshot consistency kontrolou.');
assert.ok(unpricedValidation > financialOfferValidation, 'Neoceněné položky se nekontrolují po oceněných položkách.');
assert.ok(financialTotals > unpricedValidation, 'Historie sčítá částky před dokončením finanční validace.');
assert.ok(financialCleanup > financialTotals, 'Seznam se čistí před serverovou finanční validací historie.');

console.log('Atomic shopping purchase completion and financial snapshot contract OK');
await import('./shopping-repeat-purchase-sync.mjs');
