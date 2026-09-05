import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const base = readFileSync(new URL('supabase/migrations/20260904133530_atomic_recipe_item_sync.sql', root), 'utf8');
const isolation = readFileSync(new URL('supabase/migrations/20260905213500_isolate_manual_rows_from_recipe_sync.sql', root), 'utf8');
const preference = readFileSync(new URL('supabase/migrations/20260905214500_prefer_recipe_target_on_sync.sql', root), 'utf8');

assert.match(base, /order by i\.is_completed asc, i\.created_at asc, i\.id/,
  'Regresní test musí hlídat původní pořadí target řádků.');
assert.match(isolation, /v_target_safe := v_target\.is_recipe;/,
  'Recipe target preference dává smysl jen se strict is_recipe ochranou.');
assert.match(preference, /pg_get_functiondef\(\s*'public\.sync_own_shopping_list_recipe_item\(uuid,text,text\[\]\)'::regprocedure\s*\)/,
  'Patch musí upravovat přesně atomický owner recipe RPC.');
assert.match(preference, /order by i\.is_recipe desc, i\.is_completed asc, i\.created_at asc, i\.id/,
  'Při shodném custom key musí být existující recipe řádek vybrán před manual řádkem.');
assert.match(preference, /has_recipe_preference[\s\S]*?already applied; skipping replay/i,
  'Patch musí být replay-safe po úspěšném nasazení.');
assert.match(preference, /Expected recipe target ordering was not found/,
  'Patch musí při driftu původního RPC fail-closed skončit chybou.');

// Model the ordering that the database query must implement.
const rows = [
  { id:'manual-old', is_recipe:false, is_completed:false, created_at:'2026-09-01T08:00:00Z' },
  { id:'recipe-new', is_recipe:true, is_completed:false, created_at:'2026-09-05T08:00:00Z' },
  { id:'recipe-done', is_recipe:true, is_completed:true, created_at:'2026-09-02T08:00:00Z' },
];
const ordered = [...rows].sort((a, b) =>
  Number(b.is_recipe) - Number(a.is_recipe)
  || Number(a.is_completed) - Number(b.is_completed)
  || a.created_at.localeCompare(b.created_at)
  || a.id.localeCompare(b.id)
);
assert.equal(ordered[0].id, 'recipe-new',
  'Starší manual řádek nesmí blokovat existující aktivní recipe target stejného názvu.');

console.log('Recipe RPC prefers an existing recipe target over a manual row with the same key');
