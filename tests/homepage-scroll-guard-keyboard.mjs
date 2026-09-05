import assert from 'node:assert/strict';
import fs from 'node:fs';
const index = fs.readFileSync('index.html','utf8');
const quick = fs.readFileSync('assets/home-quick-food-filter.js','utf8');
assert.match(index, /keydown[^\n]*event\.key === 'Enter'/);
assert.match(quick, /event\.key === 'Enter'[\s\S]{0,80}markUserScrollIntent\(event\)/);
assert.match(index, /window\.scrollTo = \(\.\.\.args\) => userAllowedScroll\(\)/);
console.log('homepage Enter scroll intent guard: OK');
