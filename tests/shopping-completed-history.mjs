import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-insights.js', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260828131647_complete_checked_shopping_items.sql', root), 'utf8');
const hardeningMigration = readFileSync(new URL('supabase/migrations/20260828134352_reject_stale_uncompleted_shopping_completion.sql', root), 'utf8');
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
  "'full'",
  "if v_completion_mode = 'completed' then",
  'and sli.is_completed = true;',
  'if not exists (',
  'perform public.revoke_shopping_list_shares(new.shopping_list_id);',
]) assert.ok(migration.includes(needle), `Chybí původní checked-history DB kontrakt: ${needle}`);

for (const needle of [
  'v_completed_count integer := 0;',
  'v_completion_mode text := null;',
  'if v_completed_count > 0 then',
  'if v_purchase_items = v_completed_items then',
  "v_completion_mode := 'completed';",
  'elsif v_purchase_items = v_uncompleted_items then',
  "v_completion_mode := 'full';",
  "raise exception 'Nákupní seznam se mezitím změnil. Načti aktuální stav a dokončení zopakuj.';",
  "if v_completion_mode = 'completed' then",
  'and sli.is_completed = true;',
  'perform public.revoke_shopping_list_shares(new.shopping_list_id);',
]) assert.ok(hardeningMigration.includes(needle), `Chybí fail-closed checked-history DB kontrakt: ${needle}`);

assert.ok(!hardeningMigration.includes('legacy_uncompleted'), 'Aktivní hardening nesmí přijmout starý unfinished-only snapshot, když už existují odškrtnuté položky.');
const completedGuard = hardeningMigration.indexOf('if v_completed_count > 0 then');
const exactCompletedSnapshot = hardeningMigration.indexOf('if v_purchase_items = v_completed_items then', completedGuard);
const fullSnapshotBranch = hardeningMigration.indexOf('elsif v_purchase_items = v_uncompleted_items then', exactCompletedSnapshot);
const completionMismatch = hardeningMigration.indexOf("raise exception 'Nákupní seznam se mezitím změnil. Načti aktuální stav a dokončení zopakuj.';", exactCompletedSnapshot);
assert.ok(completedGuard >= 0 && exactCompletedSnapshot > completedGuard, 'Při existujících koupených položkách se nejdřív nevyžaduje jejich přesný snapshot.');
assert.ok(completionMismatch > exactCompletedSnapshot && completionMismatch < fullSnapshotBranch, 'Stale unfinished-only klient není odmítnut dřív, než se povolí full-list větev.');
assert.ok(fullSnapshotBranch > completedGuard, 'Full-list větev musí být dostupná jen tehdy, když žádná položka není odškrtnutá.');

const completedDelete = hardeningMigration.indexOf("if v_completion_mode = 'completed' then");
const partialDelete = hardeningMigration.indexOf('and sli.is_completed = true;', completedDelete);
const fullDelete = hardeningMigration.indexOf('delete from public.shopping_list_items sli', partialDelete + 1);
const shareCheck = hardeningMigration.indexOf('if not exists (', fullDelete);
const revoke = hardeningMigration.indexOf('perform public.revoke_shopping_list_shares(new.shopping_list_id);', shareCheck);
assert.ok(completedDelete >= 0 && partialDelete > completedDelete, 'Completed mode nemaže jen koupené položky.');
assert.ok(fullDelete > partialDelete, 'Full cleanup větev chybí.');
assert.ok(shareCheck > fullDelete && revoke > shareCheck, 'Share se má revokovat až po ověření, že seznam je skutečně prázdný.');

const insightsUrl = bootstrap.match(/const INSIGHTS_URL = '([^']+)'/)?.[1] || '';
assert.equal(insightsUrl, 'assets/shopping-insights.js?v=20260828-1', 'Bootstrap nemá checked-history shopping-insights v1.');
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
const bootstrapMatch = bootstrapUrl.match(/v=(\d{8})-(\d+)$/);
assert.ok(bootstrapMatch, 'seznam.html nemá verzovaný checked-history bootstrap.');
const bootstrapDate = Number(bootstrapMatch[1]);
const bootstrapRevision = Number(bootstrapMatch[2]);
assert.ok(
  bootstrapDate > 20260828 || (bootstrapDate === 20260828 && bootstrapRevision >= 8),
  'Checked-history bootstrap nesmí klesnout pod baseline 20260828-8.',
);

// Public page assets are intentionally no longer install-time precache entries.
// They are network-first/runtime cached after successful use, so a missing
// optional shopping asset cannot block installation of the entire PWA.
assert.ok(!worker.includes(`'/${insightsUrl}'`), 'Checked-history insights se nemá vracet do monolitického install-time precache.');
assert.ok(!worker.includes(`'/${bootstrapUrl}'`), 'Checked-history bootstrap se nemá vracet do monolitického install-time precache.');
assert.ok(worker.includes('putRuntime(request, response)'), 'PWA nemá runtime cache cestu pro navštívené shopping assety.');
assert.ok(worker.includes("cache: 'reload'"), 'Kritické shopping JS musí zůstat network-first.');
const cacheMatch = worker.match(/CACHE_VERSION = '(\d{8})-(\d+)'/);
assert.ok(cacheMatch, 'PWA cache nemá očekávaný verzovaný formát YYYYMMDD-revision.');
const cacheDate = Number(cacheMatch[1]);
const cacheRevision = Number(cacheMatch[2]);
assert.ok(
  cacheDate > 20260828 || (cacheDate === 20260828 && cacheRevision >= 65),
  'PWA cache se nesmí vrátit pod checked-history baseline 20260828-65.',
);

console.log('Checked shopping history is fail-closed against stale unfinished-only completion snapshots');
