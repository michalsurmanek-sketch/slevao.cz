import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const workflowsDir = new URL('../.github/workflows/', import.meta.url);
const files = readdirSync(workflowsDir).filter((name) => name.endsWith('.yml')).sort();

const deprecated = [
  ['actions/checkout@v4', 'actions/checkout@v7'],
  ['actions/setup-node@v4', 'actions/setup-node@v7'],
  ['actions/upload-artifact@v4', 'actions/upload-artifact@v7'],
  ['supabase/setup-cli@v1', 'supabase/setup-cli@v2'],
];

const findings = [];
for (const file of files) {
  const source = readFileSync(new URL(file, workflowsDir), 'utf8');
  for (const [oldRef, replacement] of deprecated) {
    if (source.includes(oldRef)) findings.push(`${file}: ${oldRef} -> ${replacement}`);
  }
  if (source.includes('supabase/setup-cli@') && /version:\s*latest\b/.test(source)) {
    findings.push(`${file}: Supabase CLI version: latest -> 2.116.0`);
  }
}

assert.equal(
  findings.length,
  0,
  `GitHub Actions stále používají zastaralý nebo nepinovaný runtime:\n${findings.join('\n')}`,
);

console.log(`GitHub Actions runtime guard: ${files.length} workflow souborů bez zastaralých action refs a nepinovaného Supabase CLI.`);
