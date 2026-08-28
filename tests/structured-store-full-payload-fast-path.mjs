import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(
  new URL('supabase/migrations/20260828172732_add_structured_store_full_payload_no_change_fast_path.sql', root),
  'utf8',
);
const sql = migration.toLowerCase();

assert.ok(
  sql.includes('set schema private') && sql.includes('rename to publish_structured_store_offers_full'),
  'Původní generic publisher musí být schovaný v private jako full fallback.',
);
assert.ok(
  sql.includes('from public, anon, authenticated, service_role') &&
  sql.includes('grant execute on function private.publish_structured_store_offers_full') &&
  sql.includes('to postgres'),
  'Service role nesmí volat private full publisher přímo.',
);
for (const fragment of [
  "'store_slug', p_store_slug",
  "'adapter', p_adapter",
  "'signature', p_signature",
  "'rows', v_canonical_rows",
  "'min_products', p_min_products",
  "'max_products', p_max_products",
  "'source_document_url', p_source_document_url",
  "'parser_version', v_parser",
]) {
  assert.ok(sql.includes(fragment), `Full-payload hash neobsahuje ${fragment}.`);
}
assert.ok(sql.includes("'sha256'"), 'Full-payload fingerprint musí používat SHA-256.');
assert.ok(
  sql.includes("li.status='published'") &&
  sql.includes("li.source_hash=p_adapter||':'||p_signature") &&
  sql.includes("li.metadata->>'full_payload_hash_version'='structured-full-payload-v1'") &&
  sql.includes("li.metadata->>'full_payload_sha256'=v_payload_hash"),
  'Fast-path musí vyžadovat exact published import/signature/full hash.',
);
assert.ok(
  sql.includes('if v_live_count=v_import_product_count') &&
  sql.includes('and v_live_count>=p_min_products') &&
  sql.includes('from public.store_product_sync_state ss'),
  'Fast-path musí fail-safe spadnout do full publish při rozbité živé sadě.',
);
assert.ok(
  sql.includes("'no_changes',true") && sql.includes("'no_change_fast_path_at',v_now"),
  'No-change branch musí být explicitní a telemetrizovaný.',
);
const fastStart = sql.indexOf('if v_import_id is not null then');
const fallbackStart = sql.indexOf('v_result := private.publish_structured_store_offers_full(');
const fastBranch = sql.slice(fastStart, fallbackStart);
assert.ok(!fastBranch.includes('update public.offers'),
  'No-change generic branch nesmí zapisovat offers.');
assert.ok(fallbackStart >= 0,
  'Jakákoli odchylka musí volat původní private full publisher.');
const persistHash = sql.indexOf("'full_payload_sha256',v_payload_hash", fallbackStart);
assert.ok(persistHash > fallbackStart,
  'Po full publish se musí uložit hash pro příští exact retry.');
assert.ok(
  sql.includes('revoke all on function public.publish_structured_store_offers') &&
  sql.includes('from public, anon, authenticated') &&
  sql.includes('to postgres, service_role'),
  'Veřejný generic wrapper musí zůstat server-only.',
);

console.log('Structured store full-payload no-change fast-path contract OK');
