import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const canonical = '20260901-1';
const refs = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      const source = fs.readFileSync(full, 'utf8');
      for (const match of source.matchAll(/assets\/public-features\.js\?v=([0-9]{8}-[0-9]+)/g)) refs.push({ file:path.relative(root, full), version:match[1] });
    }
  }
}
walk(root);
assert.ok(refs.length >= 4, `Expected at least 4 public-features references, got ${refs.length}`);
assert.deepEqual(refs.filter((ref) => ref.version !== canonical), []);
console.log(`public-features cache version: OK (${refs.length} references)`);
