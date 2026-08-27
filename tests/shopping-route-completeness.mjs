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
  'const branch = compatibleBranchForStore(storeId, chosen, branches);',
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

const functionStart = source.indexOf('  function compatibleBranchForStore(');
const functionEnd = source.indexOf('\n  function planFor(', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'Branch compatibility helper nejde izolovaně otestovat.');
const helper = source.slice(functionStart, functionEnd);

const branches = [
  { id:'wrong-nearest', store_id:'store-1', city:'Brno', distance_km:1 },
  { id:'correct-farther', store_id:'store-1', city:'Olomouc', distance_km:4 },
];
const chosen = [{ offer:{ store_id:'store-1', coverage_scope:'city', city_name:'Olomouc' } }];
const context = {
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
${helper}
globalThis.result = compatibleBranchForStore('store-1', chosen, branches);
`, { filename:'shopping-route-branch-coverage-test.js' }).runInNewContext(context);
assert.equal(context.result?.id, 'correct-farther', 'GPS plán nesmí navigovat na bližší pobočku, kde zvolená cena neplatí.');

console.log('Shopping route completeness and branch coverage OK');
