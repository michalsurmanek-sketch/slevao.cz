import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const homeSource = readFileSync(new URL('assets/home-recipes.js', root), 'utf8');
const indexHtml = readFileSync(new URL('index.html', root), 'utf8');
const guardSource = readFileSync(new URL('assets/shopping-recipe-quantity-guard.js', root), 'utf8');
const coldSyncSource = readFileSync(new URL('assets/shopping-owner-cold-sync.js', root), 'utf8');
const listHtml = readFileSync(new URL('seznam.html', root), 'utf8');
const candidateMigration = readFileSync(new URL('supabase/migrations/20260903212317_add_safe_recipe_search_aliases.sql', root), 'utf8');

assert.ok(indexHtml.includes('assets/home-recipes.js?v=20260904-1'), 'Homepage must load the canonical external recipe runtime.');
assert.ok(!indexHtml.includes('const RECIPES = {'), 'Homepage must not keep a second inline copy of recipe logic.');
new Script(homeSource, { filename:'assets/home-recipes.js' });
new Script(guardSource, { filename:'assets/shopping-recipe-quantity-guard.js' });
new Script(coldSyncSource, { filename:'assets/shopping-owner-cold-sync.js' });

assert.match(homeSource, /LEGACY_RECIPE_START = Date\.parse\('2026-09-03T08:15:00Z'\)/, 'Legacy migration must be bounded to the recipe rollout window.');
assert.match(homeSource, /LEGACY_RECIPE_END = Date\.parse\('2026-09-03T09:00:00Z'\)/, 'Legacy migration must have an explicit end time.');
assert.match(homeSource, /legacyRecipeRows = new Map\(/, 'Legacy migration must require an exact recipe name\/quantity\/unit signature.');
assert.doesNotMatch(homeSource, /legacyRecipeNames = new Set/, 'Broad name-only recipe migration must never return.');
assert.match(homeSource, /source:'recipe',recipe_id:key,recipe_ids:\[key\]/, 'New recipe rows must carry complete recipe provenance.');
assert.match(homeSource, /quantity:1,qty:1,unit:'ks'/, 'A recipe ingredient must count as one shopping-list row regardless of grams or millilitres.');
assert.match(homeSource, /function mergeRecipeProvenance\(/, 'Identical ingredients shared by recipes must merge recipe provenance instead of duplicating rows.');
assert.match(homeSource, /row\.recipe_dirty = 1/, 'Merged recipe provenance must be marked for cloud synchronization.');

assert.match(candidateMigration, /create or replace function public\.get_public_shopping_list_candidates/i, 'Recipe candidate normalization must be persisted as a database migration.');
assert.ok(candidateMigration.includes('kg|g|ml|l|ks|balení|stroužky'), 'Candidate search must recognize recipe amount annotations.');
assert.match(candidateMigration, /p_query\s*=>\s*rec\.search_text/, 'Offer lookup must search the normalized ingredient name.');
assert.doesNotMatch(candidateMigration, /p_query\s*=>\s*rec\.query_text/, 'Offer lookup must not search the display name including recipe quantity.');
assert.match(candidateMigration, /with ordinality as page_row\(offer\s*,\s*total_count\s*,\s*candidate_ord\)/i, 'Candidate ranking must use the current public offer RPC return contract.');
assert.ok(!candidateMigration.includes('normalize_search_text'), 'Recipe candidate lookup must not depend on the removed normalize_search_text helper.');

// Safe aliases preserve the original recipe identity while searching a more reliable catalogue term.
assert.match(candidateMigration, /q\.base_text as ingredient_text/, 'The original recipe ingredient must be preserved separately from its search alias.');
assert.match(candidateMigration, /when 'marmelada' then 'Džem'/, 'Marmelada must safely search the current catalogue as jam.');
assert.match(candidateMigration, /when 'hovezi maso' then 'Hovězí zadní'/, 'Generic goulash beef must search a whole-cut beef term instead of minced products.');
assert.match(candidateMigration, /when 'hladka mouka' then 'Pšeničná mouka'/, 'Plain flour must search the wheat-flour catalogue when the exact title omits smoothness.');
assert.match(candidateMigration, /description_text/, 'Flour alias validation must inspect source description metadata.');
assert.match(candidateMigration, /hladka mouka[\s\S]*?spald\|zitn\|celozrnn\|bezlepk\|hrub\|polohrub/, 'Plain flour must reject spelt, rye, wholegrain, gluten-free, coarse and semi-coarse substitutes.');
assert.match(candidateMigration, /description_text\s*~\s*'\(\^\| \)hladka\( \|\$\)'/, 'Plain flour alias must require an explicit hladka source description.');

// Recipe matching must be fail-closed: semantic identity first, price second.
assert.match(candidateMigration, /as is_recipe/, 'Recipe-aware candidate filtering must stay explicit.');
assert.match(candidateMigration, /filter_group'\s*,?''\)='food'|filter_group'\s*,?\s*''\)\s*=\s*'food'/, 'Recipe candidates must stay inside the food group.');
assert.match(candidateMigration, /stem_count\s*=\s*s\.token_count|s\.stem_count\s*=\s*s\.token_count/, 'Every meaningful recipe token must match the candidate identity.');
assert.match(candidateMigration, /max_exact_count/, 'Recipe candidates must prefer the highest exact-token identity.');
assert.match(candidateMigration, /detska vyziva\|kojeneck\|krmiv/, 'Infant-food and pet-food contexts must not leak into recipe ingredients.');
assert.match(candidateMigration, /hovezi maso[\s\S]*?mlet\|meln\|burger\|tatarak/, 'Generic beef for goulash must reject minced\/burger substitutes.');
assert.match(candidateMigration, /sadlo[\s\S]*?bez kuze[\s\S]*?maso a ryby/, 'Recipe lard must reject raw pork fat \/ meat-category substitutes.');
assert.match(candidateMigration, /strouhanka[\s\S]*?panko\|japonsk/, 'Generic breadcrumbs must not silently turn into Panko.');
assert.match(candidateMigration, /parmazan[\s\S]*?a la parmazan\|styl parmazan/, 'Parmesan must not silently turn into imitation a-la-Parmesan cheese.');
assert.match(candidateMigration, /olej na smazeni'[\s\S]*?then 'Olej'/, 'Frying oil must search the generic oil catalogue instead of the full cooking phrase.');
assert.match(candidateMigration, /slunecnic\|repk\|rostlinn\|frit/, 'Generic recipe oil must stay limited to ordinary cooking oils.');
assert.match(candidateMigration, /quantity_text'[\s\S]*?\(ml\|l\)/, 'Generic oil candidates must represent an actual liquid oil package.');

// Recipe amount annotations affect purchase cost, never shopping-list piece quantity.
assert.match(candidateMigration, /recipe_base_price/, 'Adjusted recipe offers must preserve their original package\/base price.');
assert.match(candidateMigration, /recipe_purchase_multiplier/, 'Adjusted recipe offers must expose the purchase multiplier.');
assert.match(candidateMigration, /recipe_required_amount/, 'Adjusted recipe offers must expose the required recipe amount.');
assert.match(candidateMigration, /purchase_multiplier/, 'Candidate pricing must calculate a recipe purchase multiplier.');
assert.match(candidateMigration, /variable_price/, 'Per-kilogram\/per-litre offers must be distinguished from fixed packages.');
assert.match(candidateMigration, /ceil\(/, 'Fixed packages must round required package counts upward.');
assert.match(candidateMigration, /'%cena za%'/, 'Loose\/per-unit pricing must recognize the public quantity label.');
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
assert.ok(
  coldSyncSource.includes(".select('id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed,created_at,updated_at,is_recipe,recipe_ids')"),
  'Cold sync must load stale-repair fields plus recipe provenance.'
);
assert.ok(
  coldSyncSource.includes('const repairedRemote = await repairRemoteRecipeRows(remoteRows);'),
  'Cold sync must repair stale cloud recipe rows before shopping-list merge.'
);
const staleReconcilePos = coldSyncSource.indexOf('let nextRows = reconcileBeforeMerge(localRows, snapshot.remoteRows);');
const recipeSyncPos = coldSyncSource.indexOf('const recipeSync = await syncLocalRecipeRows(nextRows);', staleReconcilePos);
assert.ok(
  staleReconcilePos >= 0 && recipeSyncPos > staleReconcilePos,
  'Cold sync must remove remotely deleted rows before recipe synchronization to prevent resurrection.'
);
assert.ok(!coldSyncSource.includes("if (!localRows.some((row) => row?.server_id))"), 'Cold sync must not skip cloud repair just because local rows have no server_id yet.');

const guardPos = listHtml.indexOf('assets/shopping-recipe-quantity-guard.js');
const bootstrapPos = listHtml.indexOf('assets/shopping-insights-bootstrap.js');
assert.ok(guardPos >= 0, 'Shopping-list page must load the recipe quantity guard.');
assert.ok(bootstrapPos > guardPos, 'Recipe quantity guard must run before shopping-list bootstrap and cloud synchronization.');

console.log('recipe shopping quantity + identity + pricing + safe alias regression guard: OK');
