import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const wrapper = readFileSync(
  new URL('supabase/migrations/20260828175954_add_lidl_verified_full_payload_no_change_fast_path.sql', root),
  'utf8',
).toLowerCase();
const align = readFileSync(
  new URL('supabase/migrations/20260828180255_align_lidl_full_payload_matcher_and_backfill_current_hash.sql', root),
  'utf8',
).toLowerCase();

assert.ok(
  wrapper.includes('set schema private') && wrapper.includes('rename to publish_lidl_verified_markdown_full'),
  'Původní těžký Lidl publisher musí zůstat jako private full fallback.',
);
assert.ok(
  wrapper.includes('revoke all on function private.publish_lidl_verified_markdown_full') &&
  wrapper.includes('from public, anon, authenticated, service_role') &&
  wrapper.includes('to postgres'),
  'Service role nesmí obcházet Lidl wrapper přímým full publish voláním.',
);
assert.ok(
  wrapper.includes("pg_advisory_xact_lock(hashtextextended('slevao:lidl-verified-markdown',0))"),
  'Lidl publish musí serializovat souběžné retry ve stejné transakci.',
);
for (const needle of [
  "'publisher_contract','lidl-verified-full-payload-v1'",
  "'parser_contract','lidl-verified-pdf-text-v2'",
  "'signature',v_signature",
  "'valid_from',p_valid_from",
  "'valid_to',p_valid_to",
  "'pdf_url',p_pdf_url",
  "'rows',v_canonical_rows",
  "'sha256'",
]) {
  assert.ok(wrapper.includes(needle), `Lidl full-payload fingerprint postrádá ${needle}.`);
}
assert.ok(
  wrapper.includes("li.status='published'") &&
  wrapper.includes("li.source_hash='lidl-verified-pdf-text-v1:'||v_signature") &&
  wrapper.includes("li.metadata->>'full_payload_hash_version'='lidl-verified-full-payload-v1'") &&
  wrapper.includes("li.metadata->>'full_payload_sha256'=v_payload_hash"),
  'Fast-path musí vyžadovat přesný published import a full-payload hash.',
);
assert.ok(
  wrapper.includes('private.lidl_verified_rows_match_published_set(') &&
  wrapper.includes('v_import_product_count=v_count') &&
  wrapper.includes('from public.store_product_sync_state ss'),
  'Hash sám nestačí; fast-path musí ověřit živou publikovanou sadu a sync state.',
);
assert.ok(
  align.includes('public.normalize_product_name(o.title)=e.normalized_title') &&
  !align.includes('and o.title=e.title'),
  'Matcher musí respektovat canonicalizaci nabídky, která odděluje balení od titulku.',
);
assert.ok(
  align.includes("o.unit_price is not distinct from e.unit_price") &&
  align.includes("o.metadata->>'source_signature'") &&
  align.includes("o.metadata->>'adapter'") &&
  align.includes("o.coverage_scope='national'"),
  'Exact matcher musí krýt publikovanou cenu, jednotkovou cenu, provenance a scope.',
);
assert.ok(
  wrapper.includes("'no_changes',true") && wrapper.includes("'no_change_fast_path_at',v_now"),
  'No-change větev musí být explicitně telemetrizovaná.',
);
assert.ok(
  wrapper.includes("health_status='degraded'") && wrapper.includes("'partial_coverage',true"),
  'Fast-path nesmí změnit význam částečného Lidl coverage na plně zdravý feed.',
);
const fastStart = wrapper.indexOf('if v_import_id is not null');
const fallbackStart = wrapper.indexOf('v_result := private.publish_lidl_verified_markdown_full(');
assert.ok(fastStart >= 0 && fallbackStart > fastStart, 'Lidl wrapper musí mít fast-path před full fallbackem.');
assert.ok(!wrapper.slice(fastStart, fallbackStart).includes('update public.offers'),
  'No-change Lidl branch nesmí přepisovat offers.');
assert.ok(wrapper.indexOf("'full_payload_sha256',v_payload_hash", fallbackStart) > fallbackStart,
  'Po změně payloadu musí full publish uložit nový hash pro další retry.');
assert.ok(
  wrapper.includes('revoke all on function public.publish_lidl_verified_markdown') &&
  wrapper.includes('from public, anon, authenticated') &&
  wrapper.includes('to postgres, service_role'),
  'Veřejný Lidl wrapper musí zůstat server-only.',
);
assert.ok(
  align.includes('v_row_count=v_product_count') &&
  align.includes('private.lidl_verified_rows_match_published_set(') &&
  align.includes("'full_payload_backfilled_at'") &&
  align.includes("'full_payload_hash_version','lidl-verified-full-payload-v1'"),
  'Backfill současného importu musí být fail-closed a smí se zapsat jen po exact live matchi.',
);

console.log('Lidl full-payload no-change fast-path contract OK');
