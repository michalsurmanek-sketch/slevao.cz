import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const source = readFileSync('supabase/functions/sync-pepco-source/index.ts', 'utf8');

assert.match(source, /const PUBLISH_URL = `\$\{SUPABASE_URL\}\/functions\/v1\/publish-imports`/,
  'Pepco sync must use the internal publisher endpoint.');
assert.match(source, /async function publishImport\(importId: string\)/,
  'Pepco sync must synchronously publish review imports.');
assert.match(source, /authorization: `Bearer \$\{SERVICE_ROLE_KEY\}`/,
  'Internal Pepco publication must authenticate with service role, never a public key.');
assert.match(source, /existing && \['review', 'publishing'\]\.includes[\s\S]*publishResult = await publishImport\(existing\.id\)/,
  'Existing Pepco review imports must be resumed and published before success.');
assert.match(source, /publishResult = await publishImport\(imported\.id\);[\s\S]*currentOfferCount[\s\S]*markSourceSuccess/,
  'New Pepco imports must publish and verify offers before source success is recorded.');
assert.match(source, /archive_reason: 'superseded_pepco_review'/,
  'Superseded Pepco review imports must be archived instead of published later.');
assert.match(source, /parsed >= 2|parsed >= 2 && parsed < 100_000/,
  'Pepco parser must respect the global 2 CZK public price floor.');
assert.match(source, /timeZone: 'Europe\/Prague'/,
  'Pepco validity must use the Prague calendar boundary.');
assert.match(source, /if \(range\.to < pragueToday\(\)\) throw new Error/,
  'Expired Pepco collections must fail closed.');

function section(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `Missing Pepco parser section: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `Missing Pepco parser section end: ${end}`);
  return source.slice(from, to);
}

const parserSource = [
  section('function validIsoDate', '\n\nfunction dateRange'),
  section('function dateRange', '\n\nfunction parseDateRange'),
  section('function parseDateRange', '\n\nfunction collectionTitle'),
].join('\n')
  .replace(/: number/g, '')
  .replace(/html: string/g, 'html')
  .replace(/\): DateRange \| null/g, ')')
  .replace(/const months: Record<string, number>/g, 'const months');

const context = {};
new Script(`
  function clean(value) { return String(value || '').replace(/\\s+/g, ' ').trim(); }
  function pragueYear() { return 2026; }
  ${parserSource}
  globalThis.crossMonth = parseDateRange('Hity týdne od 27. srpna do 2. září');
  globalThis.sameMonth = parseDateRange('v nabídce od 21. do 27. srpna');
  globalThis.numeric = parseDateRange('od 27. 8. do 2. 9.');
`, { filename:'pepco-validity-parser.js' }).runInNewContext(context);

assert.equal(
  JSON.stringify(context.crossMonth),
  JSON.stringify({ from:'2026-08-27', to:'2026-09-02' }),
  'Pepco must parse a named validity range that crosses from August into September.'
);
assert.equal(
  JSON.stringify(context.sameMonth),
  JSON.stringify({ from:'2026-08-21', to:'2026-08-27' }),
  'Pepco same-month named validity parsing must remain intact.'
);
assert.equal(
  JSON.stringify(context.numeric),
  JSON.stringify({ from:'2026-08-27', to:'2026-09-02' }),
  'Pepco numeric validity parsing must remain intact.'
);

console.log('Pepco sync publishes and verifies before reporting success.');
