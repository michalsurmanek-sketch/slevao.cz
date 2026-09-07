import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const loader = read('assets/admin-store-delete.js');
const adminDelete = read('assets/admin-store-delete-hotfix.js');
const edgeFunction = read('supabase/functions/delete-store/index.ts');
const edgeConfig = read('supabase/functions/delete-store/config.toml');
const deployWorkflow = read('.github/workflows/deploy-edge-functions.yml');

new Script(loader, { filename: 'assets/admin-store-delete.js' });
new Script(adminDelete, { filename: 'assets/admin-store-delete-hotfix.js' });

assert.match(loader, /admin-store-delete-hotfix\.js[\s\S]*Date\.now\(\)/, 'Administrace nevynucuje čerstvou verzi mazání obchodů.');
for (const pattern of [
  /data-store-permanent-delete/,
  /getAdminSession\(\)/,
  /app_metadata\?\.role !== 'admin'/,
  /storeDeleteConfirmInput[\s\S]*selectedStore\.slug/,
  /db\.from\('stores'\)\.delete\(\)/,
  /db\.from\('offers'\)\.delete\(\)/,
  /db\.from\('leaflet_imports'\)\.delete\(\)/,
  /db\.from\('leaflet_sources'\)\.delete\(\)/,
  /isForeignKeyError/,
  /Trvale smazat obchod/,
]) {
  assert.match(adminDelete, pattern, `Přímé mazání obchodu postrádá ochranu ${pattern}.`);
}
assert.doesNotMatch(adminDelete, /functions\/v1\/delete-store|\bfetch\s*\(/, 'Administrace nesmí být pro smazání závislá na Edge Function fetch požadavku.');

for (const pattern of [
  /userData\.user\.app_metadata\?\.role !== 'admin'/,
  /payload\.confirmation/,
  /db\.from\('stores'\)[\s\S]*\.delete\(\)/,
]) {
  assert.match(edgeFunction, pattern, `Záložní serverové smazání postrádá ochranu ${pattern}.`);
}
assert.match(edgeConfig, /verify_jwt\s*=\s*true/, 'Mazací funkce musí mít zapnuté ověření JWT na gateway.');

const specializedBlock = deployWorkflow.match(/handled_elsewhere=\([\s\S]*?\n\s*\)/)?.[0] || '';
assert.ok(specializedBlock, 'Deploy workflow nemá explicitní seznam specializovaných funkcí.');
assert.doesNotMatch(specializedBlock, /^\s*delete-store\s*$/m, 'delete-store nesmí být vyřazen z changed-only generic deploye.');
assert.doesNotMatch(deployWorkflow, /supabase functions deploy delete-store/, 'delete-store se nesmí nasazovat bezpodmínečným samostatným krokem.');
assert.match(deployWorkflow, /function_name="\$\{BASH_REMATCH\[1\]\}"/, 'Deploy workflow neumí zařadit změněný adresář delete-store mezi generické funkce.');
assert.match(deployWorkflow, /config_file="\$\{function_dir\}\/config\.toml"/, 'Changed-only deploy musí načítat per-function auth konfiguraci.');
assert.match(deployWorkflow, /if \[\[ "\$auth_mode" == 'false' \]\]; then[\s\S]*--no-verify-jwt[\s\S]*else[\s\S]*supabase functions deploy "\$function_name"/, 'Generic deploy musí zachovat verify_jwt=true bez --no-verify-jwt.');

console.log('Store deletion safeguards OK');
