import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/sync-albert-source/index.ts', 'utf8');
const start = source.indexOf('function pragueYear()');
const end = source.indexOf('function safePdfUrl');
assert.ok(start >= 0 && end > start, 'Albert date parser functions must stay present.');

let parserSource = source.slice(start, end)
  .replace(/function pragueYear\(\)\s*\{[\s\S]*?\n\}/, 'function pragueYear() { return 2026; }')
  .replace('function parseCzechDate(value?: string | null)', 'function parseCzechDate(value)');

const { parseCzechDate } = new Function(`${parserSource}\nreturn { parseCzechDate };`)();

assert.equal(parseCzechDate('26.08.2926'), '2026-08-26',
  'Known Albert 29YY century typo must be repaired inside the narrow safe window.');
assert.equal(parseCzechDate('01.09.2026'), '2026-09-01',
  'Normal Albert dates must remain unchanged.');
assert.throws(() => parseCzechDate('31.02.2026'), /neplatné datum/i,
  'Impossible calendar dates must still fail closed.');
assert.throws(() => parseCzechDate('01.01.3926'), /neplatné datum/i,
  'Unrelated absurd years must never be auto-repaired.');
assert.match(source, /if \(validFrom > validTo\) throw new Error/,
  'Albert import must reject reversed validity ranges.');

console.log('Albert leaflet date repair stays narrow and fail-closed.');
