import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

console.log('Pepco sync publishes and verifies before reporting success.');
