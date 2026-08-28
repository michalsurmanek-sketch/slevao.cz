import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-insights.js', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260828131647_complete_checked_shopping_items.sql', root), 'utf8');
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-insights.js' });

for (const needle of [
  'async function calculateRows(targetRows)',
  'metrics = await calculateRows(rows.filter((row) => !row.completed && !row.is_completed));',
  'function completionSelection()',
  'const completedRows = rows.filter((row) => Boolean(row.completed || row.is_completed));',
  'rows: completedRows.length ? completedRows : rows.slice()',
  'checkedOnly: completedRows.length > 0',
  "$('completeShopping').disabled = sharedMode || !rows.length || busy;",
  'const completionMetrics = await calculateRows(selection.rows);',
  'const selectedIds = new Set(selection.rows.map((row) => row.local_id).filter(Boolean));',
  'rows.filter((row) => !selectedIds.has(row.local_id))',
  "localStorage.setItem(LIST_KEY, JSON.stringify(remainingRows));",
]) assert.ok(source.includes(needle), `Chybí checked-history klientský kontrakt: ${needle}`);

const completionStart = source.indexOf('  async function completeShopping()');
const completionEnd = source.indexOf('\n  function rowFromSnapshot', completionStart);
assert.ok(completionStart >= 0 && completionEnd > completionStart, 'completeShopping nejde izolovaně zkontrolovat.');
const completionBlock = source.slice(completionStart, completionEnd);
assert.ok(!completionBlock.includes("db.from('shopping_list_items').delete()"), 'Klient po atomickém purchase INSERTu stále maže celý cloudový seznam.');
assert.ok(!completionBlock.includes("revoke_shopping_list_shares"), 'Klient stále revokuje share mimo atomický DB trigger.');
assert.ok(completionBlock.includes("selection.checkedOnly"), 'Dokončení nerozlišuje koupené-only a full-list režim.');

const selectionStart = source.indexOf('  function completionSelection()');
const selectionEnd = source.indexOf('\n  async function completeShopping()', selectionStart);
const selectionFn = source.slice(selectionStart, selectionEnd);
const selectionContext = { result:null };
new Script(`
  let rows = [
    { local_id:'a', completed:true },
    { local_id:'b', completed:false },
    { local_id:'c', is_completed:true }
  ];
  ${selectionFn}
  const checked = completionSelection();
  rows = [{ local_id:'x', completed:false }, { local_id:'y', completed:false }];
  const full = completionSelection();
  globalThis.result = {
    checkedIds: checked.rows.map((row) => row.local_id),
    checkedOnly: checked.checkedOnly,
    fullIds: full.rows.map((row) => row.local_id),
    fullCheckedOnly: full.checkedOnly
  };
`).runInNewContext(selectionContext);
assert.deepEqual(Array.from(selectionContext.result.checkedIds), ['a','c'], 'Při odškrtnutých položkách se do historie nevybírají právě koupené řádky.');
assert.equal(selectionContext.result.checkedOnly, true);
assert.deepEqual(Array.from(selectionContext.result.fullIds), ['x','y'], 'Bez odškrtnutých položek se nevybírá celý seznam.');
assert.equal(selectionContext.result.fullCheckedOnly, false);

for (const needle of [
  'v_completed_count integer := 0;',
  'v_completion_mode text := null;',
  "and sli.is_completed = true",
  "and sli.is_completed = false",
  "v_completion_mode := 'completed';",
  "'legacy_uncompleted'",
  "'full'",
  "if v_completion_mode = 'completed' then",
  'and sli.is_completed = true;',
  'if not exists (',
  'perform public.revoke_shopping_list_shares(new.shopping_list_id);',
]) assert.ok(migration.includes(needle), `Chybí checked-history DB kontrakt: ${needle}`);
const completedDelete = migration.indexOf("if v_completion_mode = 'completed' then");
const partialDelete = migration.indexOf('and sli.is_completed = true;', completedDelete);
const fullDelete = migration.indexOf('delete from public.shopping_list_items sli', partialDelete + 1);
const shareCheck = migration.indexOf('if not exists (', fullDelete);
const revoke = migration.indexOf('perform public.revoke_shopping_list_shares(new.shopping_list_id);', shareCheck);
assert.ok(completedDelete >= 0 && partialDelete > completedDelete, 'Completed mode nemaže jen koupené položky.');
assert.ok(fullDelete > partialDelete, 'Full/legacy cleanup větev chybí.');
assert.ok(shareCheck > fullDelete && revoke > shareCheck, 'Share se má revokovat až po ověření, že seznam je skutečně prázdný.');

const insightsUrl = bootstrap.match(/const INSIGHTS_URL = '([^']+)'/)?.[1] || '';
assert.equal(insightsUrl, 'assets/shopping-insights.js?v=20260828-1', 'Bootstrap nemá checked-history shopping-insights v1.');
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.equal(bootstrapUrl, 'assets/shopping-insights-bootstrap.js?v=20260828-8', 'seznam.html nemá checked-history bootstrap v8.');
assert.ok(worker.includes(`'/${insightsUrl}'`), 'PWA necachuje přesný checked-history insights asset.');
assert.ok(worker.includes(`'/${bootstrapUrl}'`), 'PWA necachuje přesný checked-history bootstrap asset.');
const shellVersion = Number(worker.match(/CACHE_NAME = 'slevao-shell-20260828-(\d+)'/)?.[1] || 0);
assert.ok(shellVersion >= 65, 'PWA shell nebyl po checked-history fixu posunut na verzi 65+.');

console.log('Checked shopping items are saved to history while unfinished items are preserved');
