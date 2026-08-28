import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = 'supabase/migrations/20260828181311_add_coop_verified_full_payload_no_change_fast_path.sql';
const sql = readFileSync(path, 'utf8');

assert.match(sql, /'publisher_contract','coop-verified-full-payload-v1'/,
  'COOP musí mít explicitně verzovaný full-payload publisher kontrakt.');
assert.match(sql, /extensions\.digest\([\s\S]*'sha256'/,
  'COOP full-payload fingerprint musí používat SHA-256.');

for (const field of [
  "'external_key'",
  "'title'",
  "'normalized_title'",
  "'quantity_text'",
  "'price'",
  "'unit_price'",
  "'image_url'",
  "'metadata'",
  "'valid_from'",
  "'valid_to'",
]) {
  assert.ok(sql.includes(field), `COOP canonical payload postrádá pole ${field}.`);
}

assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('slevao:coop-verified-markdown',0\)\)/,
  'COOP publish/reuse rozhodnutí musí být serializované advisory lockem.');
assert.match(sql, /private\.coop_verified_rows_match_published_set\(/,
  'Fast path musí ověřit skutečný published offer set, ne jen hash importu.');
assert.match(sql, /li\.metadata->>'full_payload_hash_version'='coop-verified-full-payload-v1'/,
  'Reuse musí vyžadovat správnou verzi full-payload hashe.');
assert.match(sql, /li\.metadata->>'full_payload_sha256'=v_payload_hash/,
  'Reuse musí vyžadovat přesný SHA-256 vstupního payloadu.');
assert.match(sql, /v_import_product_count=v_count/,
  'Reuse musí ověřit počet položek importu.');
assert.match(sql, /'no_change_fast_path_at',v_now/,
  'No-change běh musí být diagnosticky označen v metadata importu.');
assert.match(sql, /'no_changes',true/,
  'No-change běh musí být explicitně označen ve výsledku nebo sync metadata.');
assert.match(sql, /'expired',0/,
  'No-change větev nesmí expirovat nabídky.');

const noChangeStart = sql.indexOf("if v_import_id is not null");
const noChangeReturn = sql.indexOf("return jsonb_build_object(", noChangeStart);
const fullPublisherCall = sql.indexOf("v_result := private.publish_coop_verified_markdown_full", noChangeStart);
assert.ok(noChangeStart >= 0 && noChangeReturn > noChangeStart && fullPublisherCall > noChangeReturn,
  'No-change větev se musí vrátit před voláním plného publisheru.');
const noChangeBranch = sql.slice(noChangeStart, fullPublisherCall);
assert.doesNotMatch(noChangeBranch, /\b(update|insert into|delete from)\s+public\.offers\b/i,
  'No-change fast path nesmí přímo měnit tabulku offers.');

for (const invariant of [
  "o.source_url=p_pdf_url",
  "o.price=e.price",
  "o.old_price is null",
  "o.unit_price is not distinct from e.unit_price",
  "o.valid_from=p_valid_from",
  "o.valid_to=p_valid_to",
  "o.is_verified=true",
  "o.confidence_score=0.99",
  "o.coverage_scope='store'",
  "o.store_location_name='Vybrané prodejny COOP'",
  "o.region_code is null",
  "o.city_name is null",
  "coalesce(o.metadata->>'source_signature','')=p_signature",
]) {
  assert.ok(sql.includes(invariant), `COOP published-set matcher postrádá invariant ${invariant}.`);
}
assert.match(sql, /published_count[\s\S]*=p_count[\s\S]*exact_matches[\s\S]*=p_count/,
  'COOP matcher musí vyžadovat přesně celý published set, ne podmnožinu.');

for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(sql, new RegExp(`revoke all on function public\\.publish_coop_verified_markdown\\(text,bigint,text\\)[\\s\\S]*from public, anon, authenticated`, 'i'),
    `COOP SECURITY DEFINER publisher nesmí být spustitelný rolí ${role}.`);
}
assert.match(sql, /grant execute on function public\.publish_coop_verified_markdown\(text,bigint,text\)[\s\S]*to postgres, service_role/,
  'COOP publisher musí zůstat dostupný pouze trusted rolím.');
assert.match(sql, /revoke all on function private\.coop_verified_rows_match_published_set[\s\S]*from public, anon, authenticated, service_role/,
  'Interní exact matcher nesmí být přímé klientské RPC.');

console.log('COOP verified full-payload fast path contract OK');
