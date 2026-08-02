import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const adminDelete = read('assets/admin-store-delete.js');
const modernUi = read('assets/admin-modern-ui.js');
const edgeFunction = read('supabase/functions/delete-store/index.ts');
const edgeConfig = read('supabase/functions/delete-store/config.toml');
const deployWorkflow = read('.github/workflows/deploy-edge-functions.yml');

new Script(adminDelete, { filename: 'assets/admin-store-delete.js' });

assert.match(modernUi, /assets\/admin-store-delete\.js\?v=20260802-1/, 'Administrace nenačítá ovládání pro smazání obchodu.');
for (const pattern of [
  /data-store-permanent-delete/,
  /action: 'preview'/,
  /action: 'delete'/,
  /confirmation: selectedStore\.slug/,
  /Trvale smazat obchod/,
  /const role = await currentRole\(\);[\s\S]*role !== 'admin'/,
  /new AbortController\(\)/,
  /controller\.abort\(\)/,
  /REQUEST_TIMEOUT_MS = 12000/,
  /Načtení obchodu selhalo/,
]) {
  assert.match(adminDelete, pattern, `Ovládání mazání obchodu postrádá ochranu ${pattern}.`);
}

for (const pattern of [
  /userData\.user\.app_metadata\?\.role !== 'admin'/,
  /payload\.confirmation/,
  /db\.from\('stores'\)[\s\S]*\.delete\(\)/,
  /db\.from\('leaflet_imports'\)\.delete\(\)/,
  /db\.storage\.from\(bucket\)\.remove/,
  /action === 'preview'/,
]) {
  assert.match(edgeFunction, pattern, `Serverové smazání obchodu postrádá ochranu ${pattern}.`);
}
assert.doesNotMatch(edgeFunction, /role !== 'admin'.*editor/s, 'Editor nesmí získat oprávnění k trvalému smazání obchodu.');
assert.match(edgeConfig, /verify_jwt\s*=\s*false/, 'Mazací funkce musí ověřovat přihlášení uvnitř funkce.');
assert.match(deployWorkflow, /functions deploy delete-store[\s\S]*--no-verify-jwt/, 'Mazací funkce se nenasazuje samostatně.');

console.log('Store deletion safeguards OK');
