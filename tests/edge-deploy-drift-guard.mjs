import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const workflow = readFileSync(new URL('.github/workflows/deploy-edge-functions.yml', root), 'utf8');

assert.match(workflow, /fetch-depth:\s*0/, 'Deploy workflow potřebuje historii pro bezpečný diff změněných funkcí.');
assert.match(workflow, /git diff --name-only[^\n]*"\$before"[^\n]*"\$GITHUB_SHA"[\s\S]*supabase\/functions/, 'Workflow neurčuje změněné Edge Functions z git diffu.');
assert.match(workflow, /config_file="\$\{function_dir\}\/config\.toml"/, 'Workflow nekontroluje per-function auth config.');
assert.match(workflow, /verify_jwt\[\[:space:\]\]\*=\[\[:space:\]\]\*\(true\|false\)/, 'Workflow nevyžaduje explicitní verify_jwt hodnotu.');
assert.match(workflow, /auth_mode="\$\(sed -nE/, 'Workflow nepřekládá auth manifest do skutečného deploy režimu.');
assert.match(workflow, /if \[\[ "\$auth_mode" == 'false' \]\]; then[\s\S]*--no-verify-jwt[\s\S]*else[\s\S]*supabase functions deploy "\$function_name"/, 'verify_jwt=false musí nasadit --no-verify-jwt a verify_jwt=true bez tohoto přepínače.');
assert.match(workflow, /Deploy je zastaven, aby se neznámý auth režim nepřepsal/, 'Workflow nemá fail-closed ochranu auth režimu.');
assert.match(workflow, /supabase functions deploy "\$function_name"/, 'Workflow nenasazuje konkrétní změněnou funkci.');
assert.doesNotMatch(workflow, /supabase functions deploy \\\n\s*--project-ref uhampjdqjxmbhaptgitn/, 'Workflow se nesmí vrátit k hromadnému deployi všech funkcí.');
assert.match(workflow, /Ruční hromadný deploy je z bezpečnostních důvodů vypnutý/, 'workflow_dispatch nesmí obejít changed-only guard.');

console.log('Edge deploy drift guard OK');
