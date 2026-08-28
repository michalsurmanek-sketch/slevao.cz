import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(
  new URL('supabase/migrations/20260828172345_add_globus_full_payload_no_change_fast_path.sql', root),
  'utf8',
);
const sql = migration.toLowerCase();

assert.ok(
  sql.includes('set schema private') && sql.includes('rename to publish_globus_olomouc_offers_full'),
  'Původní těžký Globus publisher musí být schovaný v private jako full fallback.',
);
assert.ok(
  sql.includes('from public, anon, authenticated, service_role') &&
  sql.includes('grant execute on function private.publish_globus_olomouc_offers_full') &&
  sql.includes('to postgres'),
  'Service role nesmí obcházet veřejný fast-path wrapper přímým full publish voláním.',
);
assert.ok(
  sql.includes("'rows', v_canonical_rows") &&
  sql.includes("'source_document_url', p_source_document_url") &&
  sql.includes("'parser_version', p_parser_version") &&
  sql.includes("'reported_total_count', p_reported_total_count") &&
  sql.includes("'accessible_product_count', p_accessible_product_count") &&
  sql.includes("'sha256'"),
  'Fast-path fingerprint musí krýt celý kanonický payload i telemetry parametry.',
);
assert.ok(
  sql.includes("li.status = 'published'") &&
  sql.includes("li.source_hash = 'globus-action-products-api-v1:' || p_signature") &&
  sql.includes("li.metadata ->> 'full_payload_hash_version' = 'globus-full-payload-v1'") &&
  sql.includes("li.metadata ->> 'full_payload_sha256' = v_payload_hash"),
  'No-change branch musí vyžadovat published import, správný source hash a přesný full-payload hash.',
);
assert.ok(
  sql.includes('if v_scoped >= 300') &&
  sql.includes('from public.store_product_sync_state ss'),
  'Fast-path se smí použít jen při zdravé živé scoped sadě a existujícím sync state.',
);
assert.ok(
  sql.includes("'no_changes', true") &&
  sql.includes("'no_change_fast_path_at', v_now"),
  'No-change větev musí být explicitně telemetrizovaná.',
);
const fallback = sql.indexOf('v_result := private.publish_globus_olomouc_offers_full(');
const persistHash = sql.indexOf("'full_payload_sha256', v_payload_hash", fallback);
assert.ok(fallback >= 0 && persistHash > fallback,
  'Při změně payloadu musí wrapper zavolat full publisher a teprve potom uložit nový hash.');
assert.ok(
  sql.includes('revoke all on function public.publish_globus_olomouc_offers') &&
  sql.includes('from public, anon, authenticated') &&
  sql.includes('to postgres, service_role'),
  'Veřejný wrapper musí být dostupný jen serverovým rolím.',
);

const fastBranchStart = sql.indexOf('if v_import_id is not null then');
const fallbackStart = sql.indexOf('v_result := private.publish_globus_olomouc_offers_full(');
const fastBranch = sql.slice(fastBranchStart, fallbackStart);
assert.ok(!fastBranch.includes('update public.offers'),
  'No-change branch nesmí přepisovat offers a znovu spouštět offer trigger lavinu.');

console.log('Globus full-payload no-change fast-path contract OK');
await import('./structured-store-full-payload-fast-path.mjs');
