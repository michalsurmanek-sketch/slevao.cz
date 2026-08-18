import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const fn = read('supabase/functions/match-product-catalog/index.ts');
const config = read('supabase/functions/match-product-catalog/config.toml');
const queueMigration = read('supabase/migrations/20260805002500_product_catalog_match_queue.sql');
const lockMigration = read('supabase/migrations/20260808105000_lock_internal_authenticated_job_rpc.sql');

assert.match(config, /^verify_jwt\s*=\s*false\s*$/m, 'Catalog matcher musí zůstat v custom-auth režimu pro DB cron launcher.');
assert.match(fn, /x-cron-secret/, 'Catalog matcher neověřuje cron secret.');
assert.match(fn, /SERVICE_ROLE_KEY/, 'Catalog matcher neověřuje service-role volání.');
assert.match(fn, /\['admin', 'editor'\]/, 'Catalog matcher neomezuje user JWT na admin/editor.');
assert.match(queueMigration, /create or replace function public\.queue_product_catalog_matching/i, 'Queue launcher není source-controlled.');
assert.match(queueMigration, /functions\/v1\/match-product-catalog/, 'Queue launcher nevolá catalog matcher.');
assert.match(queueMigration, /x-cron-secret/, 'Queue launcher neposílá cron secret.');
assert.match(lockMigration, /revoke execute on function public\.queue_product_catalog_matching\(integer\) from public, anon, authenticated;/, 'Queue launcher není odebraný klientským rolím.');
assert.match(lockMigration, /grant execute on function public\.queue_product_catalog_matching\(integer\) to service_role;/, 'Queue launcher nemá explicitní service_role grant.');

console.log('Catalog matcher custom auth boundary OK');
