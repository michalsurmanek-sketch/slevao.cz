import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-route.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-route.js' });

for (const needle of [
  "const rows = a.readList().filter((row) => !row.completed);",
  "db.rpc('get_public_shopping_list_candidates'",
  'async function fetchCustomRouteOffers(rows, storeIds, branches)',
  '__shopping_query_key:',
  'function offersForRow(row, offers, allowedStores)',
  'function compatibleBranchForStore(storeId, chosen, branches)',
  'storeOffers.every((offer) => api().coverageMatches(offer, [branch]))',
  'function branchCompatibleStorePlan(storeId, storeItems, offers, branches, position, kmCost)',
  'api().coverageMatches(candidate, [branch])',
  'const fallback = branchCompatibleStorePlan(storeId, storeItems, offers, branches, position, kmCost);',
  'const [productOffers, customOffers] = await Promise.all([',
  'const offers = [...productOffers, ...customOffers];',
]) {
  assert.ok(source.includes(needle), `Chybí GPS route guard: ${needle}`);
}

assert.doesNotMatch(
  source,
  /a\.readList\(\)\.filter\(\(row\) => !row\.completed && row\.product_id\)/,
  'GPS optimizer stále zahazuje vlastní položky před výpočtem.'
);

const compatibilityStart = source.indexOf('  function compatibleBranchForStore(');
const compatibilityEnd = source.indexOf('\n  function branchCompatibleStorePlan(', compatibilityStart);
assert.ok(compatibilityStart >= 0 && compatibilityEnd > compatibilityStart, 'Branch compatibility helper nejde izolovaně otestovat.');
const compatibilityHelper = source.slice(compatibilityStart, compatibilityEnd);

const branches = [
  { id:'wrong-nearest', store_id:'store-1', city:'Brno', distance_km:1 },
  { id:'correct-farther', store_id:'store-1', city:'Olomouc', distance_km:4 },
];
const chosen = [{ offer:{ store_id:'store-1', coverage_scope:'city', city_name:'Olomouc' } }];
const compatibilityContext = {
  branches,
  chosen,
  result:null,
  String,
  Number,
  api: () => ({
    coverageMatches(offer, candidateBranches) {
      if (offer.coverage_scope === 'city') return candidateBranches.some((branch) => branch.city === offer.city_name);
      return true;
    },
  }),
};
new Script(`
${compatibilityHelper}
globalThis.result = compatibleBranchForStore('store-1', chosen, branches);
`, { filename:'shopping-route-branch-coverage-test.js' }).runInNewContext(compatibilityContext);
assert.equal(compatibilityContext.result?.id, 'correct-farther', 'GPS plán nesmí navigovat na bližší pobočku, kde zvolená cena neplatí.');

const fallbackStart = source.indexOf('  function offersForRow(');
const fallbackEnd = source.indexOf('\n  function planFor(', fallbackStart);
assert.ok(fallbackStart >= 0 && fallbackEnd > fallbackStart, 'Branch-compatible offer fallback nejde izolovaně otestovat.');
const fallbackHelpers = source.slice(fallbackStart, fallbackEnd);

const fallbackBranches = [
  { id:'branch-a', store_id:'store-1', latitude:0, longitude:1, distance_km:1 },
  { id:'branch-b', store_id:'store-1', latitude:0, longitude:2, distance_km:2 },
];
const storeItems = [
  { row:{ product_id:'product-a', quantity:1 }, offer:{ id:'a-cheap', store_id:'store-1', product_id:'product-a', branch_id:'branch-a', coverage_scope:'store', price:10 } },
  { row:{ product_id:'product-b', quantity:1 }, offer:{ id:'b-only', store_id:'store-1', product_id:'product-b', branch_id:'branch-b', coverage_scope:'store', price:20 } },
];
const fallbackOffers = [
  storeItems[0].offer,
  { id:'a-compatible', store_id:'store-1', product_id:'product-a', branch_id:'branch-b', coverage_scope:'store', price:12 },
  storeItems[1].offer,
];
const fallbackContext = {
  storeItems,
  fallbackOffers,
  fallbackBranches,
  result:null,
  Set,
  String,
  Number,
  Boolean,
  norm: (value) => String(value || '').toLowerCase(),
  api: () => ({
    coverageMatches(offer, candidateBranches) {
      if (offer.coverage_scope === 'store') return candidateBranches.some((branch) => String(branch.id) === String(offer.branch_id));
      return true;
    },
    distanceKm(lat1, lon1, lat2, lon2) {
      return Math.abs(Number(lon2) - Number(lon1)) + Math.abs(Number(lat2) - Number(lat1));
    },
  }),
};
new Script(`
${fallbackHelpers}
globalThis.result = branchCompatibleStorePlan('store-1', storeItems, fallbackOffers, fallbackBranches, { latitude:0, longitude:0 }, 0);
`, { filename:'shopping-route-compatible-offer-fallback-test.js' }).runInNewContext(fallbackContext);
assert.equal(fallbackContext.result?.branch?.id, 'branch-b', 'GPS fallback nenašel pobočku, kde lze koupit všechny položky.');
assert.deepEqual(
  Array.from(fallbackContext.result?.items || [], (item) => item.offer.id),
  ['a-compatible', 'b-only'],
  'GPS fallback nepřepnul z nejlevnější nekompatibilní nabídky na společně koupitelnou sadu.'
);
assert.equal(fallbackContext.result?.subtotal, 32, 'GPS fallback spočítal chybnou cenu společně koupitelné sady.');

console.log('Shopping route completeness, branch coverage and offer fallback OK');
