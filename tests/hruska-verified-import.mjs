import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('supabase/functions/sync-hruska-products/index.ts', root), 'utf8');

const jsForSyntax = source
  .replace(/^import .*$/gm, '')
  .replace(/Deno\.env\.get\([^)]*\)!/g, "''")
  .replace(/:\s*[A-Z][A-Za-z0-9_<>{}\[\]|:';, ]*(?=[,)=;{])/g, '')
  .replace(/\s+as\s+[A-Z][A-Za-z0-9_<>{}\[\]|:';, ]*/g, '');

assert.match(
  source,
  /from\('leaflet_import_items'\)\.delete\(\)\.eq\('import_id',\s*importId\)/,
  'Ověřený Hruška parser nemaže celý předchozí obsah importu.',
);
assert.doesNotMatch(
  source,
  /delete\(\)\.eq\('import_id',\s*importId\)\.neq\('status',\s*'published'\)/,
  'Ověřený Hruška parser znovu ponechává nebezpečné řádky základního OCR.',
);
assert.match(source, /unit_price_match/, 'Hruška parser neověřuje shodu jednotkové ceny.');
assert.ok(
  source.includes("if (/\\\\bnase cena\\\\b/.test(norm(title))) return null;"),
  'Hruška parser nezamítá název, který zasáhl do sousedního cenového sloupce.',
);
assert.match(source, /confidence:\s*0\.99/, 'Ověřené Hruška položky nemají vysokou deterministickou důvěru.');

console.log('Hruska verified replacement OK');
