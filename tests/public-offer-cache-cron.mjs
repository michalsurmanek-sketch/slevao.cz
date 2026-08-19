import fs from 'node:fs';

const path = 'supabase/migrations/20260819142657_harden_public_offer_cache_cron.sql';
if (!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql = fs.readFileSync(path, 'utf8');

for (const needle of [
  "c.relname='public_offer_search_cache'",
  "idx.relname='public_offer_search_cache_offer_id_uidx'",
  'i.indisunique',
  'i.indisvalid',
  'i.indisready',
  "jobname='refresh-public-offer-search-cache'",
  "REFRESH MATERIALIZED VIEW CONCURRENTLY private.public_offer_search_cache",
  "to_regclass('public.public_offer_search_cache_v2') is null",
  "jobname='refresh-public-offer-search-cache-v2'",
  "cron.unschedule('refresh-public-offer-search-cache-v2')",
]) {
  if (!sql.includes(needle)) throw new Error(`Missing public offer cache cron guard: ${needle}`);
}

if (/REFRESH MATERIALIZED VIEW private\.public_offer_search_cache(?!\s*')/i.test(sql)) {
  throw new Error('Public offer cache cron must not restore non-concurrent refresh.');
}
if (/job_id\s*:=\s*129|cron\.unschedule\(130\)/i.test(sql)) {
  throw new Error('Cron hardening migration must not depend on production job IDs.');
}
if (/create\s+materialized\s+view/i.test(sql) || /drop\s+materialized\s+view/i.test(sql)) {
  throw new Error('Cron hardening must not recreate the public offer cache.');
}

console.log('Public offer cache cron hardening OK');
