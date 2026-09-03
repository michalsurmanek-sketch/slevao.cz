import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('supabase/migrations/20260903213107_scope_recipe_aliases_to_recipe_rows.sql', root), 'utf8');
const passata = readFileSync(new URL('supabase/migrations/20260903214459_add_safe_recipe_passata_alias.sql', root), 'utf8');

assert.match(source, /btrim\(value\)\s*~\*[\s\S]*?as is_recipe/i, 'Recipe detection must be computed before search alias selection.');
assert.match(source, /case when q\.is_recipe then[\s\S]*?when 'marmelada' then 'Džem'[\s\S]*?when 'hovezi maso' then 'Hovězí zadní'[\s\S]*?when 'hladka mouka' then 'Pšeničná mouka'[\s\S]*?else q\.base_text[\s\S]*?end[\s\S]*?else q\.base_text end as search_text/i,
  'Safe aliases must apply only to recipe rows; manual custom items must keep their original search text.');
assert.match(source, /q\.base_text as ingredient_text/, 'Original ingredient identity must remain available for recipe-specific semantic guards.');
assert.match(source, /where not rec\.is_recipe or \(/, 'Recipe-only semantic restrictions must not alter ordinary manual custom-item matching.');
assert.match(source, /case when rec\.is_recipe and a\.req is not null and a\.pkg is not null then jsonb_set/i,
  'Purchase-amount price rewriting must remain recipe-only.');

assert.match(passata, /when 'hladka mouka' then 'Pšeničná mouka'[\s\S]*?when 'rajcatove pyre' then 'Passata'[\s\S]*?else q\.base_text/,
  'Tomato puree recipe alias must be inserted inside the existing recipe-only alias branch.');
assert.match(passata, /if definition = original then[\s\S]*?raise exception 'Expected recipe alias fragment was not found'/,
  'Passata migration must fail closed if the expected recipe-only alias branch changes.');
assert.match(passata, /pg_get_functiondef\('public\.get_public_shopping_list_candidates\(text\[\],integer\)'::regprocedure\)/,
  'Passata alias must update the current shopping candidate RPC, not a stale helper.');

console.log('Recipe search aliases, including passata, are scoped to recipe rows only: OK');
