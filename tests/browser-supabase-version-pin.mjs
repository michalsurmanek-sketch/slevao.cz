import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const EXACT_VERSION = '2.112.4';
const exactEsm = `https://esm.sh/@supabase/supabase-js@${EXACT_VERSION}`;
const publicFeatures = fs.readFileSync('assets/public-features.js', 'utf8');

assert.match(
  publicFeatures,
  new RegExp(`import\\(['\"]https://esm\\.sh/@supabase/supabase-js@${EXACT_VERSION.replaceAll('.', '\\.') }['\"]\\)`),
  'public-features.js must keep its emergency Supabase ESM fallback pinned to the exact browser SDK version',
);
assert.equal(
  publicFeatures.includes("https://esm.sh/@supabase/supabase-js@2')"),
  false,
  'public-features.js must not use the floating Supabase v2 ESM fallback',
);

const candidates = [];
for (const entry of fs.readdirSync('.', { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.html')) candidates.push(entry.name);
}
for (const entry of fs.readdirSync('assets', { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.js')) candidates.push(path.join('assets', entry.name));
}

const floatingPattern = /https:\/\/(?:esm\.sh|cdn\.jsdelivr\.net\/npm)\/@supabase\/supabase-js@2(?=[\/ ?#'"`)\s]|$)/g;
const violations = [];
for (const file of candidates) {
  const source = fs.readFileSync(file, 'utf8');
  const matches = [...source.matchAll(floatingPattern)].map((match) => match[0]);
  if (matches.length) violations.push({ file, matches });
}

assert.deepEqual(
  violations,
  [],
  `Public browser files must not reference a floating Supabase v2 SDK: ${JSON.stringify(violations)}`,
);
assert.ok(publicFeatures.includes(exactEsm), 'Exact Supabase ESM fallback must remain present.');

console.log(`browser Supabase SDK pin guard: OK (${EXACT_VERSION})`);
