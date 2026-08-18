import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const fn = read('supabase/functions/process-automatic-pdf-v2/index.ts');
const config = read('supabase/functions/process-automatic-pdf-v2/config.toml');
const routeMigration = read('supabase/migrations/20260803225500_route_kaufland_pdf_to_automatic_processor.sql');
const lockMigration = read('supabase/migrations/20260818132000_lock_automatic_pdf_routing_trigger.sql');

assert.match(config, /verify_jwt\s*=\s*false/, 'Automatic PDF processor musí zachovat custom-auth pro DB trigger.');
assert.match(fn, /x-cron-secret/, 'Automatic PDF processor musí ověřovat cron secret.');
assert.match(fn, /authorization === `Bearer \$\{SERVICE_ROLE_KEY\}`/, 'Automatic PDF processor musí podporovat service-role Bearer.');
assert.match(fn, /\['admin', 'editor'\]\.includes\(role\)/, 'Automatic PDF processor musí zachovat admin/editor kontrolu.');
assert.match(fn, /authorization: `Bearer \$\{SERVICE_ROLE_KEY\}`/, 'Page processor musí být volán service-role Bearerem.');
assert.match(routeMigration, /process-automatic-pdf-v2/, 'Kaufland PDF routing migrace musí mířit na automatic processor.');
assert.match(routeMigration, /x-cron-secret/, 'Kaufland PDF routing trigger musí posílat x-cron-secret.');
for (const signature of ['start_routed_kaufland_pdf_after_insert\\(\\)', 'route_kaufland_pdf_before_insert\\(\\)']) {
  const rx = new RegExp(`revoke all on function public\\.${signature} from authenticated`, 'i');
  assert.match(lockMigration, rx, `Trigger ${signature} nesmí být dostupný authenticated roli.`);
}
assert.match(lockMigration, /grant execute on function public\.start_routed_kaufland_pdf_after_insert\(\) to service_role/i, 'Routed PDF trigger musí zachovat service_role grant.');

console.log('Automatic PDF auth boundary OK');
