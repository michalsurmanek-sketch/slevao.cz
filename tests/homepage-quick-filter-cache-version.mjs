import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync('index.html','utf8');
const matches = [...html.matchAll(/assets\/home-quick-food-filter\.js\?v=([^"']+)/g)].map((m) => m[1]);
assert.deepEqual(matches, ['20260905-1']);
assert.doesNotMatch(html, /home-quick-food-filter\.js\?v=20260829-4/);
console.log('homepage quick filter cache version: OK');
