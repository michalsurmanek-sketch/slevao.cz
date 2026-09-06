import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const workflowsDir = new URL('../.github/workflows/', import.meta.url);
const files = readdirSync(workflowsDir).filter((name) => name.endsWith('.yml')).sort();

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
  `GitHub Actions stále používají zastaralý Node runtime:\n${findings.join('\n')}`,
);

console.log(`GitHub Actions runtime guard: ${files.length} workflow souborů bez checkout/setup-node/upload-artifact @v4.`);
