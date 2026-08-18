import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const fn = read('supabase/functions/generate-leaflet-product-crops/index.ts');
const config = read('supabase/functions/generate-leaflet-product-crops/config.toml');
const grants = read('supabase/migrations/20260808105000_lock_internal_authenticated_job_rpc.sql');
const workflow = read('.github/workflows/deploy-manual-leaflet-upload.yml');

assert.match(config, /verify_jwt\s*=\s*false/, 'Crop processor musí zachovat custom-auth pro DB trigger s x-cron-secret.');
assert.match(fn, /x-cron-secret/, 'Crop processor musí ověřovat cron secret.');
assert.match(fn, /authorization === `Bearer \$\{SERVICE_ROLE_KEY\}`/, 'Crop processor musí podporovat interní service-role Bearer.');
assert.match(fn, /\['admin', 'editor'\]\.includes\(role\)/, 'Crop processor musí zachovat admin/editor kontrolu.');
assert.match(grants, /revoke execute on function public\.queue_leaflet_crop_backfill\(integer\) from public, anon, authenticated/i, 'Crop backfill launcher nesmí být dostupný klientským rolím.');
assert.match(grants, /revoke execute on function public\.start_leaflet_product_crops_after_status\(\) from public, anon, authenticated/i, 'Crop trigger function nesmí být dostupný klientským rolím.');
assert.match(grants, /grant execute on function public\.queue_leaflet_crop_backfill\(integer\) to service_role/i, 'Crop backfill launcher musí mít explicitní service_role grant.');
const deploy = workflow.match(/supabase functions deploy generate-leaflet-product-crops[\s\S]*?(?=\n\s*- name:)/)?.[0] || '';
assert.match(deploy, /--no-verify-jwt/, 'Deploy musí zachovat custom-auth režim crop processoru.');

console.log('Leaflet crop auth boundary OK');
