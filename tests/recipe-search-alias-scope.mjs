import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('supabase/migrations/20260903213107_scope_recipe_aliases_to_recipe_rows.sql', root), 'utf8');
const passata = readFileSync(new URL('supabase/migrations/20260903214459_add_safe_recipe_passata_alias.sql', root), 'utf8');
const finalCandidateMigration = readFileSync(new URL('supabase/migrations/20260904182500_fix_recipe_shopping_quantity_suffix.sql', root), 'utf8');
const groundBeefMix = readFileSync(new URL('supabase/migrations/20260905203000_allow_ground_beef_mix_recipe_substitute.sql', root), 'utf8');

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

// The final production snapshot must keep the display label while matching on the clean ingredient name.
assert.match(finalCandidateMigration, /create or replace function public\.get_public_shopping_list_candidates/i,
  'Final recipe candidate behavior must be persisted as a full migration snapshot.');
assert.ok(finalCandidateMigration.includes('kg|g|ml|l|ks|balení|stroužek|stroužky|stroužků'),
  'Final candidate normalization must recognize all recipe quantity suffix forms.');
assert.match(finalCandidateMigration, /as base_text/i,
  'Final candidate migration must derive a clean ingredient base_text.');
assert.match(finalCandidateMigration, /p_query\s*=>\s*rec\.search_text/i,
  'Offer matching must use the normalized/aliased ingredient search text.');
assert.doesNotMatch(finalCandidateMigration, /p_query\s*=>\s*rec\.query_text/i,
  'Offer matching must never send the display label including recipe quantity to public search.');
assert.match(finalCandidateMigration, /select\s+rec\.query_text,/i,
  'The original recipe display label must be returned unchanged to the shopping UI.');
assert.match(finalCandidateMigration, /recipe_base_price[\s\S]*?recipe_purchase_multiplier[\s\S]*?recipe_required_amount[\s\S]*?recipe_required_unit/i,
  'Recipe candidates must retain base-price and required-amount pricing metadata.');
assert.match(finalCandidateMigration, /when 'rajcatove pyre' then 'Passata'/,
  'The final snapshot must retain the safe tomato-puree alias.');
assert.doesNotMatch(finalCandidateMigration, /normalize_search_text/i,
  'Removed normalize_search_text dependency must never return.');
assert.doesNotMatch(finalCandidateMigration, /page_row\.row_number/i,
  'Candidate matching must not depend on the removed row_number output.');
assert.match(finalCandidateMigration, /with ordinality as page_row\(offer\s*,\s*total_count\s*,\s*candidate_ord\)/i,
  'Candidate ranking must use the current public offer RPC contract.');

// "Mleté hovězí maso" may fall back to a clearly identified ground-meat mix,
// but plain "Hovězí maso" must remain protected from minced/burger substitutes.
assert.match(groundBeefMix, /when 'mlete hovezi maso' then 'Mleté maso'/,
  'Ground beef recipes must search the generic ground-meat catalogue so a mix can be offered as a substitute.');
assert.match(groundBeefMix, /ingredient_text\)\) <> 'hovezi maso' or s\.candidate_text !~ '\(mlet\|meln\|burger\|tatarak\)'/i,
  'Plain beef must continue rejecting minced, burger and tartare products.');
assert.match(groundBeefMix, /ingredient_text\)\) <> 'mlete hovezi maso'[\s\S]*?candidate_text ~ '\(\^\| \)mlet\[a-z\]\*\( \|\$\)'[\s\S]*?candidate_text ~ '\(\^\| \)maso\( \|\$\)'[\s\S]*?candidate_text ~ '\(\^\| \)hovez\[a-z\]\*\( \|\$\)'[\s\S]*?candidate_text ~ '\(\^\| \)\(mix\|smes\)\[a-z\]\*\( \|\$\)'/i,
  'Ground-beef fallback must remain limited to actual minced meat that is beef or explicitly a mix/směs.');
assert.match(groundBeefMix, /candidate_text !~ '\(\^\| \)\(kurec\|kruti\|kachn\|jehne\|ryb\)\[a-z\]\*\( \|\$\)'/i,
  'Ground-beef fallback must reject unrelated poultry, lamb and fish mince.');
assert.match(groundBeefMix, /Expected ground-beef recipe alias fragment was not found[\s\S]*?Expected ground-beef semantic guard fragment was not found/,
  'The substitute migration must fail closed if either expected production fragment drifts.');

const recipeSuffix = /\s*\(\s*[0-9]+(?:[.,][0-9]+)?\s+(?:kg|g|ml|l|ks|balení|stroužek|stroužky|stroužků)\s*\)\s*$/i;
const cleanIngredient = (value) => String(value).trim().replace(recipeSuffix, '').trim();
assert.equal(cleanIngredient('Hovězí maso (800 g)'), 'Hovězí maso');
assert.equal(cleanIngredient('Mleté hovězí maso (500 g)'), 'Mleté hovězí maso');
assert.equal(cleanIngredient('Mléko (500 ml)'), 'Mléko');
assert.equal(cleanIngredient('Hladká mouka (1 balení)'), 'Hladká mouka');
assert.equal(cleanIngredient('Česnek (3 stroužky)'), 'Česnek');
assert.equal(cleanIngredient('Česnek (1 stroužek)'), 'Česnek');
assert.equal(cleanIngredient('Česnek (5 stroužků)'), 'Česnek');
assert.equal(cleanIngredient('Rajčata (cherry)'), 'Rajčata (cherry)', 'Semantic parentheses must not be stripped as recipe quantity metadata.');

console.log('Recipe search aliases, safe ground-beef mix substitute and final quantity-suffix normalization: OK');
