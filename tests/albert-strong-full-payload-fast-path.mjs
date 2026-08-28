import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(
  new URL('supabase/migrations/20260828173230_add_albert_strong_full_payload_no_change_fast_path.sql', root),
  'utf8',
);
const sql = migration.toLowerCase();

assert.ok(
  sql.includes('set schema private') && sql.includes('rename to publish_albert_publitas_text_offers_v4_strong_full'),
  'Původní Albert strong publisher musí být private full fallback.',
);
assert.ok(
  sql.includes('revoke all on function public.publish_albert_publitas_text_offers_v4(text,jsonb)') &&
  sql.includes('from public, anon, authenticated, service_role') &&
  sql.includes('grant execute on function public.publish_albert_publitas_text_offers_v4(text,jsonb)') &&
  sql.includes('to postgres'),
  'Přímý těžký Albert v4 nesmí být dostupný service role.',
);
assert.ok(
  sql.includes("lower(coalesce(value ->> 'identity_strength',''))='strong'") &&
  sql.includes('not public.albert_variant_only_label'),
  'Wrapper musí fingerprintovat stejnou strong-safe sadu jako původní strong guard.',
);
assert.ok(
  sql.includes("'signature',p_signature") &&
  sql.includes("'strong_identity_guard','variant-only-v2'") &&
  sql.includes("'rows',v_canonical_rows") &&
  sql.includes("'sha256'"),
  'Albert fingerprint musí krýt signature, guard verzi i celý kanonický strong payload.',
);
assert.ok(
  sql.includes("li.status='published'") &&
  sql.includes("li.source_hash='albert-products-publitas-text-v4:'||v_effective_signature") &&
  sql.includes("li.metadata->>'full_payload_hash_version'='albert-strong-full-payload-v1'") &&
  sql.includes("li.metadata->>'full_payload_sha256'=v_payload_hash"),
  'Fast-path musí vyžadovat přesný published import a exact full hash.',
);
assert.ok(
  sql.includes('if v_live_count=v_import_product_count') &&
  sql.includes('and v_live_count>=50') &&
  sql.includes('from public.store_product_sync_state ss'),
  'Albert fast-path musí fail-safe kontrolovat živou sadu a sync state.',
);
assert.ok(
  sql.includes("'no_changes',true") && sql.includes("'no_change_fast_path_at',v_now"),
  'Albert no-change branch musí být explicitní a telemetrizovaný.',
);
const fastStart = sql.indexOf('if v_import_id is not null then');
const fallbackStart = sql.indexOf('v_result := private.publish_albert_publitas_text_offers_v4_strong_full(');
const fastBranch = sql.slice(fastStart, fallbackStart);
assert.ok(!fastBranch.includes('update public.offers'),
  'Albert no-change branch nesmí přepisovat offers.');
assert.ok(fallbackStart >= 0,
  'Jakákoli odchylka musí spadnout do původního private strong full publisheru.');
const persistHash = sql.indexOf("'full_payload_sha256',v_payload_hash", fallbackStart);
assert.ok(persistHash > fallbackStart,
  'Po full publish musí wrapper uložit nový full hash pro příští exact retry.');
assert.ok(
  sql.includes('revoke all on function public.publish_albert_publitas_text_offers_v4_strong(text,jsonb)') &&
  sql.includes('to postgres,service_role'),
  'Veřejný Albert strong wrapper musí zůstat server-only.',
);

console.log('Albert strong full-payload no-change fast-path contract OK');
