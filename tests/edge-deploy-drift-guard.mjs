import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/deploy-edge-functions.yml', root), 'utf8');
const officialDeploy = readFileSync(new URL('.github/workflows/deploy-official-leaflet-resolver.yml', root), 'utf8');
const automaticLeaflets = readFileSync(new URL('.github/workflows/automatic-leaflets.yml', root), 'utf8');
const officialConfig = readFileSync(new URL('supabase/functions/sync-official-leaflet-sources/config.toml', root), 'utf8');

assert.match(workflow, /fetch-depth:\s*0/, 'Deploy workflow potřebuje historii pro bezpečný diff změněných funkcí.');
assert.match(workflow, /git rev-parse "\$\{GITHUB_SHA\}\^1"/, 'Deploy workflow musí diffovat aktuální commit proti prvnímu rodiči merge commitu.');
assert.match(workflow, /git diff --name-only[^\n]*"\$before"[^\n]*"\$GITHUB_SHA"[\s\S]*supabase\/functions/, 'Workflow neurčuje změněné Edge Functions z git diffu.');
assert.match(workflow, /config_file="\$\{function_dir\}\/config\.toml"/, 'Workflow nekontroluje per-function auth config.');
assert.match(workflow, /verify_jwt\[\[:space:\]\]\*=\[\[:space:\]\]\*\(true\|false\)/, 'Workflow nevyžaduje explicitní verify_jwt hodnotu.');
assert.match(workflow, /auth_mode="\$\(sed -nE/, 'Workflow nepřekládá auth manifest do skutečného deploy režimu.');
assert.match(workflow, /if \[\[ "\$auth_mode" == 'false' \]\]; then[\s\S]*--no-verify-jwt[\s\S]*else[\s\S]*supabase functions deploy "\$function_name"/, 'verify_jwt=false musí nasadit --no-verify-jwt a verify_jwt=true bez tohoto přepínače.');
assert.match(workflow, /Deploy je zastaven, aby se neznámý auth režim nepřepsal/, 'Workflow nemá fail-closed ochranu auth režimu.');
assert.match(workflow, /supabase functions deploy "\$function_name"/, 'Workflow nenasazuje konkrétní změněnou funkci.');
assert.doesNotMatch(workflow, /supabase functions deploy \\\n\s*--project-ref uhampjdqjxmbhaptgitn/, 'Workflow se nesmí vrátit k hromadnému deployi všech funkcí.');
assert.match(workflow, /Ruční hromadný deploy je z bezpečnostních důvodů vypnutý/, 'workflow_dispatch nesmí obejít changed-only guard.');

assert.match(officialConfig, /^verify_jwt\s*=\s*true\s*$/m, 'Oficiální leaflet resolver musí mít explicitně zapnuté JWT ověření.');
assert.doesNotMatch(officialDeploy, /--no-verify-jwt/, 'Dedikovaný deploy official leaflet resolveru nesmí vypnout JWT.');
assert.match(officialDeploy, /test "\$http_code" = '401'/, 'Deploy musí živě ověřit anonymní 401 odpověď official leaflet resolveru.');
assert.match(automaticLeaflets, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/, 'Automatické letáky musí používat service-role secret.');
assert.match(automaticLeaflets, /Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY/, 'Automatické letáky neposílají service-role Bearer token.');
assert.match(automaticLeaflets, /apikey: \$SUPABASE_SERVICE_ROLE_KEY/, 'Automatické letáky neposílají service-role apikey.');
assert.doesNotMatch(automaticLeaflets, /SUPABASE_PUBLISHABLE_KEY|sb_publishable_/, 'Automatické letáky se nesmí vrátit k veřejnému publishable klíči.');

console.log('Edge deploy drift and official leaflet resolver auth guard OK');
