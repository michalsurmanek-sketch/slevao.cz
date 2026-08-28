import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(
  new URL('supabase/migrations/20260828181311_add_coop_verified_full_payload_no_change_fast_path.sql', root),
  'utf8',
).toLowerCase();

assert.ok(
  sql.includes('set schema private') && sql.includes('rename to publish_coop_verified_markdown_full'),
  'Původní těžký COOP publisher musí být private full fallback.',
);
assert.ok(
  sql.includes('revoke all on function private.publish_coop_verified_markdown_full') &&
  sql.includes('from public, anon, authenticated, service_role') &&
  sql.includes('to postgres'),
  'Service role nesmí obcházet COOP wrapper přímým full publish voláním.',
);
assert.ok(
  sql.includes("pg_advisory_xact_lock(hashtextextended('slevao:coop-verified-markdown',0))"),
  'COOP publish musí serializovat souběžné retry.',
);
for (const needle of [
  "'publisher_contract','coop-verified-full-payload-v1'",
  "'parser_contract','coop-verified-pdf-text-v1'",
  "'signature',v_signature",
  "'valid_from',v_from",
  "'valid_to',v_to",
  "'pdf_url',p_pdf_url",
  "'coverage_scope','store'",
  "'store_location_name','vybrané prodejny coop'",
  "'rows',v_canonical_rows",
  "'sha256'",
]) {
  assert.ok(sql.includes(needle), `COOP full-payload fingerprint postrádá ${needle}.`);
}
assert.ok(
  sql.includes("li.status='published'") &&
  sql.includes("li.source_hash='coop-verified-pdf-text-v1:'||v_signature") &&
  sql.includes("li.metadata->>'full_payload_hash_version'='coop-verified-full-payload-v1'") &&
  sql.includes("li.metadata->>'full_payload_sha256'=v_payload_hash"),
  'Fast-path musí vyžadovat přesný published COOP import a full hash.',
);
assert.ok(
  sql.includes('private.coop_verified_rows_match_published_set(') &&
  sql.includes('v_import_product_count=v_count') &&
  sql.includes('from public.store_product_sync_state ss'),
  'Hash sám nestačí; COOP fast-path musí ověřit živou sadu a sync state.',
);
assert.ok(
  sql.includes('public.normalize_product_name(o.title)=e.normalized_title') &&
  !sql.includes('and o.title=e.title'),
  'COOP matcher musí respektovat canonicalizaci názvu po oddělení množství.',
);
assert.ok(
  sql.includes("o.unit_price is not distinct from e.unit_price") &&
  sql.includes("o.coverage_scope='store'") &&
  sql.includes("o.store_location_name='vybrané prodejny coop'") &&
  sql.includes("o.metadata->>'source_signature'") &&
  sql.includes("o.metadata->>'adapter'"),
  'COOP exact matcher musí krýt cenu, unit-price, store scope a provenance.',
);
assert.ok(
  sql.includes("'no_changes',true") && sql.includes("'no_change_fast_path_at',v_now"),
  'COOP no-change větev musí být explicitně telemetrizovaná.',
);
assert.ok(
  sql.includes("health_status='degraded'") &&
  sql.includes("'partial_coverage',true") &&
  sql.includes("'selected_stores_only',true"),
  'COOP fast-path nesmí vydávat vybrané prodejny za plné národní pokrytí.',
);
const fastStart = sql.indexOf('if v_import_id is not null');
const fallbackStart = sql.indexOf('v_result := private.publish_coop_verified_markdown_full(');
assert.ok(fastStart >= 0 && fallbackStart > fastStart, 'COOP wrapper musí mít fast-path před full fallbackem.');
assert.ok(!sql.slice(fastStart, fallbackStart).includes('update public.offers'),
  'No-change COOP branch nesmí přepisovat offers.');
assert.ok(sql.indexOf("'full_payload_sha256',v_payload_hash", fallbackStart) > fallbackStart,
  'Po změně payloadu musí full publish uložit nový hash pro příští retry.');
assert.ok(
  sql.includes('revoke all on function public.publish_coop_verified_markdown') &&
  sql.includes('from public, anon, authenticated') &&
  sql.includes('to postgres, service_role'),
  'Veřejný COOP wrapper musí zůstat server-only.',
);
assert.ok(
  sql.includes('v_row_count=v_product_count') &&
  sql.includes("'full_payload_backfilled_at'") &&
  sql.includes("'full_payload_hash_version','coop-verified-full-payload-v1'"),
  'Backfill aktuálního COOP importu musí být fail-closed a podmíněný exact live matchem.',
);

console.log('COOP full-payload no-change fast-path contract OK');
