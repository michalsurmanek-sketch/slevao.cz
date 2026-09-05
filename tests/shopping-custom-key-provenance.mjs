import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const basePath = 'supabase/migrations/20260828121000_canonical_shopping_custom_item_key.sql';
const recipePath = 'supabase/migrations/20260904133530_atomic_recipe_item_sync.sql';
const sourceGuardPath = 'supabase/migrations/20260905213500_isolate_manual_rows_from_recipe_sync.sql';
const migrationPath = 'supabase/migrations/20260905215000_allow_manual_recipe_custom_key_coexistence.sql';

const base = readFileSync(new URL(basePath, root), 'utf8');
const recipe = readFileSync(new URL(recipePath, root), 'utf8');
const sourceGuard = readFileSync(new URL(sourceGuardPath, root), 'utf8');
const sql = readFileSync(new URL(migrationPath, root), 'utf8');

// Document the old limitation that made manual + recipe same-name rows impossible.
assert.match(base, /create unique index if not exists shopping_list_items_one_custom_key_per_list_uidx[\s\S]*?\(shopping_list_id, custom_key\)/i,
  'Base canonical migration no longer demonstrates the original two-column uniqueness this patch supersedes.');
assert.match(recipe, /add column if not exists is_recipe boolean not null default false/i,
  'Provenance-aware uniqueness requires the recipe boolean to be NOT NULL.');
assert.match(sourceGuard, /source_not_recipe_safe/,
  'Same-name coexistence must build on the source provenance guard.');

for (const needle of [
  'shopping_list_items_one_custom_key_kind_per_list_uidx',
  'ON public.shopping_list_items (shopping_list_id, custom_key, is_recipe)',
  'DROP INDEX IF EXISTS public.shopping_list_items_one_custom_key_per_list_uidx;',
  "'public.add_own_shopping_list_custom_item(text,numeric,text,uuid)'::regprocedure",
  "'public.increment_own_shopping_list_offer(uuid)'::regprocedure",
  "'public.mutate_shared_shopping_list(text,text,uuid,uuid,uuid,text,numeric,text,boolean)'::regprocedure",
  "'public.repeat_shopping_purchase(uuid)'::regprocedure",
  "'public.sync_own_shopping_list_recipe_item(uuid,text,text[])'::regprocedure",
  "'and i.custom_key = v_key' || E'\\n    and not i.is_recipe'",
  "'and i.custom_key = v_custom_key' || E'\\n      and not i.is_recipe'",
  "'and i.custom_key = v_key' || E'\\n        and not i.is_recipe'",
  "'and custom_key = v_custom_key' || E'\\n          and not is_recipe;'",
  "'and i.custom_key = v_key' || E'\\n     and i.is_recipe'",
  "RAISE EXCEPTION 'Recipe sync source provenance guard is missing';",
  "RAISE EXCEPTION 'Legacy two-column shopping custom-key unique index still exists';",
  "RAISE EXCEPTION 'Provenance-aware shopping custom-key unique index is missing';",
]) {
  assert.ok(sql.includes(needle), `Chybí provenance-aware custom-key kontrakt: ${needle}`);
}

// Every pg_get_functiondef patch must fail closed on drift instead of silently
// applying only some of the required function changes.
for (const message of [
  'Unexpected add_own_shopping_list_custom_item custom-key target count',
  'Unexpected increment_own_shopping_list_offer custom-key target count',
  'Unexpected mutate_shared_shopping_list custom-key target count',
  'Unexpected repeat_shopping_purchase custom-key update count',
  'Unexpected recipe sync custom-key target count',
  'repeat_shopping_purchase is in an unexpected partial provenance state',
]) {
  assert.ok(sql.includes(message), `Migrace nemá fail-closed kontrolu: ${message}`);
}

// Model the intended uniqueness tuple. Same canonical display name is allowed
// once as manual and once as recipe, but duplicates inside one provenance are not.
const tuple = (row) => `${row.shopping_list_id}|${row.custom_key}|${row.is_recipe ? 'recipe' : 'manual'}`;
const manual = { shopping_list_id:'list-a', custom_key:'vejce 3 ks', is_recipe:false };
const recipeRow = { shopping_list_id:'list-a', custom_key:'vejce 3 ks', is_recipe:true };
const manualDuplicate = { ...manual };
assert.notEqual(tuple(manual), tuple(recipeRow),
  'Manual a recipe row stejného custom_key musí mít odlišnou unikátní identitu.');
assert.equal(tuple(manual), tuple(manualDuplicate),
  'Dvě manual položky stejného custom_key se stále musí deduplikovat.');

// Manual RPC filters and recipe RPC filter must point in opposite provenance directions.
const manualGuardCount = (sql.match(/and not i\.is_recipe/g) || []).length;
assert.ok(manualGuardCount >= 3,
  'Owner/offer/shared manual RPC nemají všechny explicitní NOT is_recipe guardy.');
assert.match(sql, /and not is_recipe;/,
  'Repeat-purchase manual update nemá provenance guard.');
assert.match(sql, /and i\.is_recipe/,
  'Recipe sync target nemá explicitní recipe-only guard.');

console.log('Shopping custom-key uniqueness and RPCs preserve manual/recipe provenance');
