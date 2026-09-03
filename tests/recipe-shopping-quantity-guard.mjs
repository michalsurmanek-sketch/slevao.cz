import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const homeSource = readFileSync(new URL('assets/home-recipes.js', root), 'utf8');
const indexHtml = readFileSync(new URL('index.html', root), 'utf8');
const guardSource = readFileSync(new URL('assets/shopping-recipe-quantity-guard.js', root), 'utf8');
const coldSyncSource = readFileSync(new URL('assets/shopping-owner-cold-sync.js', root), 'utf8');
const listHtml = readFileSync(new URL('seznam.html', root), 'utf8');
const candidateMigration = readFileSync(new URL('supabase/migrations/20260903211500_tighten_recipe_substitute_identity.sql', root), 'utf8');

const recipeMarker = "const LIST_KEY = 'slevao-shopping-list-v1';";
const markerPos = indexHtml.indexOf(recipeMarker);
assert.ok(markerPos >= 0, 'Homepage must contain the inline recipe runtime.');
const inlineStart = indexHtml.lastIndexOf('(() => {', markerPos);
const inlineEndMarker = "document.querySelectorAll('#recipesSection [data-recipe]').forEach((button) => button.addEventListener('click', () => addRecipe(button.dataset.recipe, button)));";
const inlineEndBody = indexHtml.indexOf(inlineEndMarker, markerPos);
assert.ok(inlineStart >= 0 && inlineEndBody >= markerPos, 'Homepage inline recipe runtime boundaries must be detectable.');
const inlineClose = indexHtml.indexOf('})();', inlineEndBody + inlineEndMarker.length);
assert.ok(inlineClose > inlineEndBody, 'Homepage inline recipe runtime must close its IIFE.');
const inlineRecipeSource = indexHtml.slice(inlineStart, inlineClose + 5);
const normalizeSource = (source) => source.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');

new Script(homeSource, { filename:'assets/home-recipes.js' });
new Script(inlineRecipeSource, { filename:'index.html:inline-home-recipes' });
new Script(guardSource, { filename:'assets/shopping-recipe-quantity-guard.js' });
new Script(coldSyncSource, { filename:'assets/shopping-owner-cold-sync.js' });
assert.equal(
  normalizeSource(inlineRecipeSource),
  normalizeSource(homeSource),
  'Inline homepage recipe runtime must stay in exact sync with assets/home-recipes.js without adding another JS request.'
);

for (const source of [homeSource, inlineRecipeSource]) {
  assert.match(source, /LEGACY_RECIPE_START = Date\.parse\('2026-09-03T08:15:00Z'\)/, 'Legacy migration must be bounded to the recipe rollout window.');
  assert.match(source, /LEGACY_RECIPE_END = Date\.parse\('2026-09-03T09:00:00Z'\)/, 'Legacy migration must have an explicit end time.');
  assert.match(source, /legacyRecipeRows = new Map\(/, 'Legacy migration must require an exact recipe name/quantity/unit signature.');
  assert.doesNotMatch(source, /legacyRecipeNames = new Set/, 'Broad name-only recipe migration must never return.');
  assert.match(source, /source:'recipe',recipe_id:key/, 'New recipe rows must carry recipe provenance.');
  assert.match(source, /quantity:1,qty:1,unit:'ks'/, 'A recipe ingredient must count as one shopping-list row regardless of grams or millilitres.');
}

assert.match(candidateMigration, /create or replace function public\.get_public_shopping_list_candidates/i, 'Recipe candidate normalization must be persisted as a database migration.');
assert.ok(candidateMigration.includes('kg|g|ml|l|ks|balení|stroužky'), 'Candidate search must recognize recipe amount annotations.');
assert.match(candidateMigration, /p_query\s*=>\s*rec\.search_text/, 'Offer lookup must search the normalized ingredient name.');
assert.doesNotMatch(candidateMigration, /p_query\s*=>\s*rec\.query_text/, 'Offer lookup must not search the display name including recipe quantity.');
assert.match(candidateMigration, /with ordinality as page_row\(offer\s*,\s*total_count\s*,\s*candidate_ord\)/i, 'Candidate ranking must use the current public offer RPC return contract.');
assert.ok(!candidateMigration.includes('normalize_search_text'), 'Recipe candidate lookup must not depend on the removed normalize_search_text helper.');

// Recipe matching must be fail-closed: semantic identity first, price second.
assert.match(candidateMigration, /as is_recipe/, 'Recipe-aware candidate filtering must stay explicit.');
assert.match(candidateMigration, /filter_group'\s*,?''\)='food'|filter_group'\s*,?\s*''\)\s*=\s*'food'/, 'Recipe candidates must stay inside the food group.');
assert.match(candidateMigration, /stem_count\s*=\s*s\.token_count|s\.stem_count\s*=\s*s\.token_count/, 'Every meaningful recipe token must match the candidate identity.');
assert.match(candidateMigration, /max_exact_count/, 'Recipe candidates must prefer the highest exact-token identity.');
assert.match(candidateMigration, /detska vyziva\|kojeneck\|krmiv/, 'Infant-food and pet-food contexts must not leak into recipe ingredients.');
assert.match(candidateMigration, /hovezi maso[\s\S]*?mlet\|meln\|burger\|tatarak/, 'Generic beef for goulash must reject minced/burger substitutes.');
assert.match(candidateMigration, /hladka mouka[\s\S]*?spald\|zitn\|celozrnn\|bezlepk/, 'Plain flour must not silently turn into spelt/rye/wholegrain/gluten-free flour.');
assert.match(candidateMigration, /sadlo[\s\S]*?bez kuze[\s\S]*?maso a ryby/, 'Recipe lard must reject raw pork fat / meat-category substitutes.');
assert.match(candidateMigration, /strouhanka[\s\S]*?panko\|japonsk/, 'Generic breadcrumbs must not silently turn into Panko.');
assert.match(candidateMigration, /parmazan[\s\S]*?a la parmazan\|styl parmazan/, 'Parmesan must not silently turn into imitation a-la-Parmesan cheese.');
assert.match(candidateMigration, /olej na smazeni'[\s\S]*?then 'Olej'/, 'Frying oil must search the generic oil catalogue instead of the full cooking phrase.');
assert.match(candidateMigration, /slunecnic\|repk\|rostlinn\|frit/, 'Generic recipe oil must stay limited to ordinary cooking oils.');
assert.match(candidateMigration, /quantity_text'[\s\S]*?\(ml\|l\)/, 'Generic oil candidates must represent an actual liquid oil package.');

// Recipe amount annotations affect purchase cost, never shopping-list piece quantity.
assert.match(candidateMigration, /recipe_base_price/, 'Adjusted recipe offers must preserve their original package/base price.');
assert.match(candidateMigration, /recipe_purchase_multiplier/, 'Adjusted recipe offers must expose the purchase multiplier.');
assert.match(candidateMigration, /recipe_required_amount/, 'Adjusted recipe offers must expose the required recipe amount.');
assert.match(candidateMigration, /purchase_multiplier/, 'Candidate pricing must calculate a recipe purchase multiplier.');
assert.match(candidateMigration, /variable_price/, 'Per-kilogram/per-litre offers must be distinguished from fixed packages.');
assert.match(candidateMigration, /ceil\(/, 'Fixed packages must round required package counts upward.');
assert.match(candidateMigration, /'%cena za%'/, 'Loose/per-unit pricing must recognize the public quantity label.');
assert.match(candidateMigration, /jsonb_set\([\s\S]*?'\{price\}'/, 'The optimizer price must be replaced with the required purchase cost for recipe candidates.');
assert.match(candidateMigration, /kg\|g\|ml\|l\|ks\|kusů\|kusy\|kus/, 'Package parser must recognize Czech count-unit aliases as well as ks.');
assert.match(candidateMigration, /lower\(a\.req\[3\]\)='ks'[\s\S]*?lower\(a\.pkg\[3\]\) in \('ks','kusů','kusy','kus'\)/, 'Czech count aliases must be normalized into the same purchase-count calculation as ks.');

const initialRows = [
  {
    local_id:'legacy-recipe', product_id:null, custom_name:'Kuřecí prsa', name:'Kuřecí prsa',
    quantity:600, unit:'g', added_at:'2026-09-03T08:21:39.148Z'
  },
  {
    local_id:'manual-before', product_id:null, custom_name:'Cibule', name:'Cibule',
    quantity:4, unit:'ks', added_at:'2026-09-02T08:21:39.148Z'
  },
  {
    local_id:'manual-different-qty', product_id:null, custom_name:'Cibule', name:'Cibule',
    quantity:7, unit:'ks', added_at:'2026-09-03T08:22:00.000Z'
  }
];
let stored = JSON.stringify(initialRows);
const sandbox = {
  localStorage: {
    getItem(key) { return key === 'slevao-shopping-list-v1' ? stored : null; },
    setItem(key, value) { if (key === 'slevao-shopping-list-v1') stored = String(value); }
  },
  window: {}
};
new Script(guardSource).runInContext(createContext(sandbox));
const repaired = JSON.parse(stored);

assert.equal(repaired[0].custom_name, 'Kuřecí prsa (600 g)');
assert.equal(repaired[0].quantity, 1);
assert.equal(repaired[0].unit, 'ks');
assert.equal(repaired[0].source, 'recipe');
assert.equal(repaired[1].custom_name, 'Cibule', 'Manual items created before the rollout must remain untouched.');
assert.equal(repaired[1].quantity, 4);
assert.equal(repaired[2].custom_name, 'Cibule', 'Rows with a quantity that was never emitted by a recipe must remain untouched.');
assert.equal(repaired[2].quantity, 7);
assert.equal(sandbox.window.__slevaoRecipeQuantityGuard?.repaired, 1);

const coldSyncSandbox = {
  URLSearchParams,
  location: { search:'', hash:'' },
  document: { querySelector() { return {}; } },
  localStorage: { getItem() { return '[]'; }, setItem() {} },
  window: { SlevaoSupabase: { getClient() { return {}; } } }
};
new Script(coldSyncSource).runInContext(createContext(coldSyncSandbox));
const remoteRepair = coldSyncSandbox.window.SlevaoShoppingOwnerColdSync?.legacyRecipeRepair;
assert.equal(typeof remoteRepair, 'function', 'Owner cold sync must expose its narrowly-scoped legacy recipe repair for regression coverage.');
const cloudFix = remoteRepair({
  id:'remote-recipe', product_id:null, custom_name:'Hovězí maso', quantity:800, unit:'g',
  created_at:'2026-09-03T08:30:00.000Z'
});
assert.equal(cloudFix?.custom_name, 'Hovězí maso (800 g)');
assert.equal(cloudFix?.quantity, 1);
assert.equal(cloudFix?.unit, 'ks');
assert.equal(remoteRepair({
  id:'manual-old', product_id:null, custom_name:'Hovězí maso', quantity:800, unit:'g',
  created_at:'2026-09-02T08:30:00.000Z'
}), null, 'Cloud rows outside the recipe rollout window must remain untouched.');
assert.equal(remoteRepair({
  id:'manual-other-qty', product_id:null, custom_name:'Hovězí maso', quantity:700, unit:'g',
  created_at:'2026-09-03T08:30:00.000Z'
}), null, 'Cloud rows with a quantity not emitted by a recipe must remain untouched.');
assert.ok(coldSyncSource.includes(".select('id,product_id,custom_name,quantity,unit,created_at')"), 'Cold sync must load the fields required to identify stale recipe quantities.');
assert.ok(coldSyncSource.includes('repairRemoteRecipeRows(list.id, remoteRows)'), 'Cold sync must repair stale cloud rows before shopping-list merge.');
assert.ok(!coldSyncSource.includes("if (!localRows.some((row) => row?.server_id))"), 'Cold sync must not skip cloud repair just because local rows have no server_id yet.');

const guardPos = listHtml.indexOf('assets/shopping-recipe-quantity-guard.js');
const bootstrapPos = listHtml.indexOf('assets/shopping-insights-bootstrap.js');
assert.ok(guardPos >= 0, 'Shopping-list page must load the recipe quantity guard.');
assert.ok(bootstrapPos > guardPos, 'Recipe quantity guard must run before shopping-list bootstrap and cloud synchronization.');

console.log('recipe shopping quantity + identity + pricing + substitute regression guard: OK');
