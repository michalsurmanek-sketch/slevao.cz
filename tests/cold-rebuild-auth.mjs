import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const edgeFunction = read('supabase/functions/cold-rebuild-store/index.ts');
const edgeConfig = read('supabase/functions/cold-rebuild-store/config.toml');
const migration = read('supabase/migrations/20260818125000_track_cold_rebuild_trigger.sql');

assert.match(edgeConfig, /verify_jwt\s*=\s*false/, 'Cold rebuild musí zachovat custom-auth režim pro DB trigger s x-cron-secret.');
for (const pattern of [
  /authorization === `Bearer \$\{SERVICE_ROLE_KEY\}`/,
  /x-cron-secret/,
  /app_metadata\?\.role/,
  /STUDENY REBUILD/,
  /rollback_leaflet_cold_rebuild/,
]) {
  assert.match(edgeFunction, pattern, `Cold rebuild Edge Function postrádá ochranu ${pattern}.`);
}
for (const pattern of [
  /security definer/i,
  /vault\.decrypted_secrets/,
  /slevao_cron_secret/,
  /x-cron-secret/,
  /revoke all on function public\.trigger_cold_rebuild_store\(text\) from public/i,
  /revoke all on function public\.trigger_cold_rebuild_store\(text\) from anon/i,
  /revoke all on function public\.trigger_cold_rebuild_store\(text\) from authenticated/i,
  /grant execute on function public\.trigger_cold_rebuild_store\(text\) to service_role/i,
]) {
  assert.match(migration, pattern, `Cold rebuild RPC migrace postrádá ochranu ${pattern}.`);
}

console.log('Cold rebuild auth safeguards OK');
