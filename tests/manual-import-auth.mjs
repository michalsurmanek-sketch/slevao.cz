import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const upload = read('supabase/functions/manual-leaflet-upload-v2/index.ts');
const uploadConfig = read('supabase/functions/manual-leaflet-upload-v2/config.toml');
const processor = read('supabase/functions/process-manual-leaflet-v2/index.ts');
const processorConfig = read('supabase/functions/process-manual-leaflet-v2/config.toml');
const runner = read('supabase/functions/run-manual-leaflet-import/index.ts');
const runnerConfig = read('supabase/functions/run-manual-leaflet-import/config.toml');
const workflow = read('.github/workflows/deploy-manual-leaflet-upload.yml');

assert.match(uploadConfig, /verify_jwt\s*=\s*false/, 'Upload musí zachovat custom-auth kvůli health probe.');
assert.match(upload, /authenticatedUser\(request, db\)/, 'Upload musí ověřovat admin/editor session uvnitř funkce.');
assert.match(upload, /searchParams\.get\('health'\)/, 'Upload musí zachovat health endpoint.');

assert.match(processorConfig, /verify_jwt\s*=\s*true/, 'Procesor ručních letáků musí být za JWT gateway.');
assert.match(processor, /authorization === `Bearer \$\{SERVICE_ROLE_KEY\}`/, 'Procesor musí přijímat interní service-role Bearer.');
assert.match(processor, /\['admin', 'editor'\]\.includes\(role\)/, 'Procesor musí zachovat admin/editor kontrolu.');

assert.match(runnerConfig, /verify_jwt\s*=\s*false/, 'Cron runner musí zachovat custom-auth režim.');
assert.match(runner, /x-cron-secret/, 'Cron runner musí ověřovat x-cron-secret.');
assert.match(runner, /authorization: `Bearer \$\{SERVICE_ROLE_KEY\}`/, 'Cron runner musí processor volat service-role Bearerem.');

const processorDeploy = workflow.match(/supabase functions deploy process-manual-leaflet-v2[\s\S]*?(?=\n\s*- name:)/)?.[0] || '';
const uploadDeploy = workflow.match(/supabase functions deploy manual-leaflet-upload-v2[\s\S]*?(?=\n\s*- name:)/)?.[0] || '';
const runnerDeploy = workflow.match(/supabase functions deploy run-manual-leaflet-import[\s\S]*?(?=\n\s*- name:)/)?.[0] || '';
assert.doesNotMatch(processorDeploy, /--no-verify-jwt/, 'Deploy nesmí vypnout JWT u processoru.');
assert.match(uploadDeploy, /--no-verify-jwt/, 'Deploy musí explicitně zachovat custom-auth uploadu.');
assert.match(runnerDeploy, /--no-verify-jwt/, 'Deploy musí explicitně zachovat custom-auth cron runneru.');

console.log('Manual import auth boundary OK');
