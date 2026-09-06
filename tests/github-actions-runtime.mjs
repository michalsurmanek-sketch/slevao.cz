import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflowsDir = new URL('../.github/workflows/', import.meta.url);

// Keep this audit intentionally limited to workflows that are safe to change and
// execute without deploying to, migrating, or running live OCR against Supabase.
const files = [
  'actions-runtime-audit.yml',
  'browser-e2e.yml',
  'central-rollover-supervisor.yml',
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
];

const findings = [];
for (const file of files) {
  const source = readFileSync(new URL(file, workflowsDir), 'utf8');
  for (const [oldRef, replacement] of deprecated) {
    if (source.includes(oldRef)) findings.push(`${file}: ${oldRef} -> ${replacement}`);
  }
}

assert.equal(
  findings.length,
  0,
  `Non-Supabase CI stále používá zastaralý Node runtime:\n${findings.join('\n')}`,
);

console.log(`Non-Supabase GitHub Actions runtime guard: ${files.length} workflow souborů je na aktuálním action runtime.`);
