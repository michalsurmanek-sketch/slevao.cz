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
assert.match(deployWorkflow, /functions deploy delete-store[\s\S]*--project-ref uhampjdqjxmbhaptgitn/, 'Záložní mazací funkce se nenasazuje samostatně.');
const deleteDeployBlock = deployWorkflow.match(/supabase functions deploy delete-store[\s\S]*?(?=\n\s*- name:|\n\s*\z)/)?.[0] || '';
assert.doesNotMatch(deleteDeployBlock, /--no-verify-jwt/, 'Deploy workflow nesmí vypnout JWT ochranu delete-store.');

console.log('Store deletion safeguards OK');
