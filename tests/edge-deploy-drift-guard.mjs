import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/deploy-edge-functions.yml', root), 'utf8');
const officialDeploy = readFileSync(new URL('.github/workflows/deploy-official-leaflet-resolver.yml', root), 'utf8');
const automaticLeaflets = readFileSync(new URL('.github/workflows/automatic-leaflets.yml', root), 'utf8');
const officialConfig = readFileSync(new URL('supabase/functions/sync-official-leaflet-sources/config.toml', root), 'utf8');

assert.match(workflow, /pull_request:[\s\S]*\.github\/workflows\/deploy-edge-functions\.yml/, 'Deploy workflow musí mít PR-safe validační trigger pro vlastní změny.');
assert.match(workflow, /fetch-depth:\s*0/, 'Deploy workflow potřebuje historii pro bezpečný diff změněných funkcí.');
assert.match(workflow, /target="\$\(git rev-parse HEAD\)"/, 'Deploy plán musí pracovat s explicitním checkoutnutým head commitem.');
assert.match(workflow, /PR_BASE_SHA:[\s\S]*github\.event\.pull_request\.base\.sha/, 'PR validace musí diffovat proti base SHA pull requestu.');
assert.match(workflow, /git rev-parse "\$\{target\}\^1"/, 'Push deploy musí diffovat aktuální commit proti prvnímu rodiči.');
assert.match(workflow, /git diff --name-only "\$before" "\$target"/, 'Workflow neurčuje změněné Edge Functions z bezpečného git diffu.');
assert.match(workflow, /if \[\[ "\$path" =~ \^supabase\/functions\/\(\[\^\/\]\+\)\/ \]\]; then/, 'Workflow neumí převést změněné cesty na názvy Edge Functions.');
assert.match(workflow, /patch_changed=true[\s\S]*generic_functions\+\=\(process-leaflet\)/, 'Změna patch scriptu musí explicitně naplánovat process-leaflet.');
assert.match(workflow, /config_file="\$\{function_dir\}\/config\.toml"/, 'Workflow nekontroluje per-function auth config.');
assert.match(workflow, /verify_jwt\[\[:space:\]\]\*=\[\[:space:\]\]\*\(true\|false\)/, 'Workflow nevyžaduje explicitní verify_jwt hodnotu.');
assert.match(workflow, /auth_mode="\$\(sed -nE/, 'Workflow nepřekládá auth manifest do skutečného deploy režimu.');
assert.match(workflow, /if \[\[ "\$auth_mode" == 'false' \]\]; then[\s\S]*--no-verify-jwt[\s\S]*else[\s\S]*supabase functions deploy "\$function_name"/, 'verify_jwt=false musí nasadit --no-verify-jwt a verify_jwt=true bez tohoto přepínače.');
assert.match(workflow, /CHYBA: \$\{function_name\} nemá explicitní config\.toml s verify_jwt/, 'Workflow nemá fail-closed ochranu chybějícího auth manifestu.');
assert.match(workflow, /supabase functions deploy "\$function_name"/, 'Workflow nenasazuje konkrétní naplánovanou funkci.');
assert.doesNotMatch(workflow, /supabase functions deploy \\\n\s*--project-ref uhampjdqjxmbhaptgitn/, 'Workflow se nesmí vrátit k hromadnému deployi všech funkcí.');
assert.match(workflow, /deploy_needed=false[\s\S]*EVENT_NAME" == 'push'[\s\S]*-n "\$functions_csv"[\s\S]*deploy_needed=true/, 'Supabase token se smí potřebovat jen při skutečném push deployi změněné funkce.');
assert.match(workflow, /Ruční hromadný deploy zůstává vypnutý/, 'workflow_dispatch nesmí obejít changed-only guard.');

const specializedBlock = workflow.match(/handled_elsewhere=\([\s\S]*?\n\s*\)/)?.[0] || '';
for (const name of [
  'generate-leaflet-product-crops',
  'manual-leaflet-upload-v2',
  'prepare-manual-leaflet-upload',
  'process-manual-leaflet-v2',
  'publish-imports',
  'run-manual-leaflet-import',
  'sync-official-leaflet-sources',
]) {
  assert.match(specializedBlock, new RegExp(`^\\s*${name}\\s*$`, 'm'), `${name} musí zůstat mimo generic deploy, protože má specializovaný workflow.`);
}

assert.match(officialConfig, /^verify_jwt\s*=\s*true\s*$/m, 'Oficiální leaflet resolver musí mít explicitně zapnuté JWT ověření.');
assert.doesNotMatch(officialDeploy, /--no-verify-jwt/, 'Dedikovaný deploy official leaflet resolveru nesmí vypnout JWT.');
assert.match(officialDeploy, /test "\$http_code" = '401'/, 'Deploy musí živě ověřit anonymní 401 odpověď official leaflet resolveru.');
assert.match(automaticLeaflets, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/, 'Automatické letáky musí používat service-role secret.');
assert.match(automaticLeaflets, /Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY/, 'Automatické letáky neposílají service-role Bearer token.');
assert.match(automaticLeaflets, /apikey: \$SUPABASE_SERVICE_ROLE_KEY/, 'Automatické letáky neposílají service-role apikey.');
assert.doesNotMatch(automaticLeaflets, /SUPABASE_PUBLISHABLE_KEY|sb_publishable_/, 'Automatické letáky se nesmí vrátit k veřejnému publishable klíči.');

console.log('Edge deploy drift and official leaflet resolver auth guard OK');
