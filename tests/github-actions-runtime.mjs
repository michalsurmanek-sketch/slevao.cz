import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflowsDir = new URL('../.github/workflows/', import.meta.url);

// Every workflow listed here is safe to validate in a pull request. Production
// mutation jobs are separately guarded below so this audit never needs live
// Supabase credentials.
const files = [
  'actions-runtime-audit.yml',
  'apply-admin-integrity-migrations.yml',
  'browser-e2e.yml',
  'central-rollover-supervisor.yml',
  'cleanup-stale-edge-diagnostics.yml',
  'deploy-edge-functions.yml',
  'deploy-manual-leaflet-upload.yml',
  'deploy-official-leaflet-resolver.yml',
  'deploy-prepare-manual-leaflet-upload.yml',
  'deploy-publish-imports.yml',
  'generate-product-sitemap.yml',
  'generate-store-pages.yml',
  'lidl-document-pages-check.yml',
  'lidl-verified-parser-check.yml',
  'pwa-runtime-sync.yml',
  'quality.yml',
  'shopping-completed-history.yml',
  'shopping-owner-recipe-manual-isolation.yml',
  'static-local-assets.yml',
];

const deprecated = [
  ['actions/checkout@v4', 'actions/checkout@v7'],
  ['actions/setup-node@v4', 'actions/setup-node@v7'],
  ['actions/upload-artifact@v4', 'actions/upload-artifact@v7'],
  ['supabase/setup-cli@v1', 'supabase/setup-cli@v2'],
];

const sources = new Map();
const findings = [];
for (const file of files) {
  const source = readFileSync(new URL(file, workflowsDir), 'utf8');
  sources.set(file, source);
  for (const [oldRef, replacement] of deprecated) {
    if (source.includes(oldRef)) findings.push(`${file}: ${oldRef} -> ${replacement}`);
  }
}

assert.equal(
  findings.length,
  0,
  `GitHub Actions audit našel zastaralý action runtime:\n${findings.join('\n')}`,
);

const cliWorkflows = [
  'deploy-edge-functions.yml',
  'deploy-manual-leaflet-upload.yml',
  'deploy-official-leaflet-resolver.yml',
  'deploy-prepare-manual-leaflet-upload.yml',
  'deploy-publish-imports.yml',
];
for (const file of cliWorkflows) {
  const source = sources.get(file);
  assert.match(source, /supabase\/setup-cli@v2/, `${file}: Supabase CLI action musí být na v2.`);
  assert.match(source, /version:\s*2\.116\.0/, `${file}: Supabase CLI musí být připnuté na ověřenou verzi 2.116.0.`);
  assert.doesNotMatch(source, /version:\s*latest/, `${file}: produkční deploy nesmí používat plovoucí Supabase CLI latest.`);
}

function eventBlock(source, eventName) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${eventName}:`);
  if (start < 0) return '';
  const collected = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line) || /^  [A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(line)) break;
    collected.push(line);
  }
  return collected.join('\n');
}

const cleanup = sources.get('cleanup-stale-edge-diagnostics.yml');
assert.equal(eventBlock(cleanup, 'push'), '', 'Destruktivní diagnostic cleanup nesmí mít automatický push trigger.');
assert.match(cleanup, /cleanup:[\s\S]*needs:\s*validate[\s\S]*if:\s*github\.event_name == 'workflow_dispatch'/, 'Produkční diagnostic cleanup musí být omezený na workflow_dispatch.');
assert.match(cleanup, /Refusing non-diagnostic slug/, 'Diagnostic cleanup musí odmítat ne-diagnostické názvy.');
assert.match(cleanup, /Refusing protected baseline slug/, 'Diagnostic cleanup musí chránit baseline funkce.');

const generic = sources.get('deploy-edge-functions.yml');
const genericPush = eventBlock(generic, 'push');
assert.match(genericPush, /supabase\/functions\/\*\*/, 'Generic Edge deploy musí reagovat na změnu Edge Functions.');
assert.doesNotMatch(genericPush, /deploy-edge-functions\.yml/, 'Změna samotného generic deploy workflow nesmí spustit produkční deploy.');
assert.match(generic, /if:\s*needs\.plan\.outputs\.deploy_needed == 'true'/, 'Generic Edge deploy musí být changed-only.');
assert.match(generic, /config_file="\$\{function_dir\}\/config\.toml"/, 'Generic Edge deploy musí respektovat per-function auth config.');

const manual = sources.get('deploy-manual-leaflet-upload.yml');
assert.match(eventBlock(manual, 'push'), /deploy-manual-leaflet-upload\.yml/, 'Ruční upload má při změně workflow spustit bezpečnou validaci.');
assert.match(manual, /if:\s*needs\.validate\.outputs\.backend_changed == 'true'/, 'Ruční upload smí deployovat jen při skutečné backend změně.');
assert.match(manual, /if \[\[ "\$EVENT_NAME" == 'pull_request' \]\]; then[\s\S]*changed=false/, 'PR ručního uploadu nesmí plánovat produkční deploy.');

const admin = sources.get('apply-admin-integrity-migrations.yml');
assert.match(eventBlock(admin, 'push'), /apply-admin-integrity-migrations\.yml/, 'Admin workflow má při změně workflow spustit bezpečnou validaci.');
assert.match(eventBlock(admin, 'pull_request'), /apply-admin-integrity-migrations\.yml/, 'Admin workflow musí validovat vlastní změny ještě v pull requestu.');
assert.match(admin, /group:\s*apply-admin-integrity-migrations-\$\{\{ github\.event_name == 'pull_request'/, 'Admin PR validace nesmí sdílet produkční concurrency group.');
assert.match(admin, /if \[\[ "\$EVENT_NAME" == 'pull_request' \]\]; then[\s\S]*changed=false[\s\S]*produkční DB se nemění/, 'Admin pull request nesmí plánovat produkční databázovou mutaci.');
assert.match(admin, /if:\s*needs\.validate\.outputs\.database_changed == 'true'/, 'Admin workflow smí měnit DB jen při změně sledovaných migrací.');

for (const [file, functionPath] of [
  ['deploy-official-leaflet-resolver.yml', 'supabase/functions/sync-official-leaflet-sources/**'],
  ['deploy-prepare-manual-leaflet-upload.yml', 'supabase/functions/prepare-manual-leaflet-upload/**'],
  ['deploy-publish-imports.yml', 'supabase/functions/publish-imports/**'],
]) {
  const source = sources.get(file);
  const push = eventBlock(source, 'push');
  assert.match(push, new RegExp(functionPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${file}: push musí sledovat vlastní backend funkci.`);
  assert.doesNotMatch(push, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${file}: změna workflow nesmí sama spustit produkční deploy.`);
  assert.match(source, /if:\s*github\.event_name != 'pull_request'/, `${file}: produkční deploy musí být na PR zakázaný.`);
}

console.log(`GitHub Actions runtime + deploy safety guard: ${files.length} workflow souborů prošlo.`);
