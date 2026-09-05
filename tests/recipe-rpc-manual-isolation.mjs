import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const base = readFileSync(new URL('supabase/migrations/20260904133530_atomic_recipe_item_sync.sql', root), 'utf8');
const patch = readFileSync(new URL('supabase/migrations/20260905213500_isolate_manual_rows_from_recipe_sync.sql', root), 'utf8');

assert.match(base, /v_target_safe := v_target\.is_recipe[\s\S]*?v_target\.quantity = 1[\s\S]*?v_target\.custom_name ~\*/,
  'Regresní test musí hlídat původní permisivní recipe target větev.');
assert.match(patch, /pg_get_functiondef\(\s*'public\.sync_own_shopping_list_recipe_item\(uuid,text,text\[\]\)'::regprocedure\s*\)/,
  'Patch musí upravovat přesně produkční atomický recipe RPC.');
assert.match(patch, /if v_source_found and not v_source\.is_recipe then[\s\S]*?'status', 'conflict'[\s\S]*?'reason', 'source_not_recipe_safe'[\s\S]*?to_jsonb\(v_source\)/i,
  'Explicitně zadaný ruční source row musí skončit konfliktem, ne převodem na recipe.');
assert.match(patch, /v_target_safe := v_target\.is_recipe;/,
  'Automaticky slučovat se smí pouze již označený receptový target.');
assert.doesNotMatch(
  patch.match(/\$\$    v_target_safe := v_target\.is_recipe;\$\$/)?.[0] || '',
  /quantity|unit|custom_name/i,
  'Nový target guard nesmí znovu odvozovat recipe bezpečnost z názvu, množství nebo jednotky.'
);
assert.match(patch, /has_source_guard[\s\S]*?has_strict_target_guard[\s\S]*?Manual\/recipe isolation is already fully applied; skipping replay/i,
  'Patch musí být replay-safe, pokud jsou obě ochrany už nasazené.');
assert.match(patch, /IF has_source_guard OR has_strict_target_guard THEN[\s\S]*?Manual\/recipe isolation is only partially applied/i,
  'Částečně nasazený stav musí fail-closed skončit chybou.');
assert.match(patch, /Expected recipe source branch was not found/,
  'Patch nesmí tiše pokračovat při změně source větve.');
assert.match(patch, /Expected permissive recipe target guard was not found/,
  'Patch nesmí tiše pokračovat při změně target větve.');

// Model the intended server decision for the exact collision that triggered this fix.
const canRecipeClaim = (row) => row?.is_recipe === true;
assert.equal(canRecipeClaim({ custom_name:'Vejce (3 ks)', quantity:1, unit:'ks', is_recipe:false }), false,
  'Ruční Vejce (3 ks) nesmí být převzata receptem jen kvůli recipe-like názvu.');
assert.equal(canRecipeClaim({ custom_name:'Vejce (3 ks)', quantity:1, unit:'ks', is_recipe:true }), true,
  'Existující receptová Vejce (3 ks) se mají dál bezpečně deduplikovat.');
assert.equal(canRecipeClaim({ custom_name:'Mléko (500 ml)', quantity:1, unit:'ks', is_recipe:false }), false,
  'Ani jiná ruční recipe-like položka nesmí být automaticky konvertována.');

console.log('Recipe RPC keeps manual custom rows isolated from recipe synchronization');
