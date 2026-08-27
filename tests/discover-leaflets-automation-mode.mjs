import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('supabase/functions/discover-leaflets/index.ts', root), 'utf8');

const filterBlock = source.match(/const dueSources = \(sources \|\| \[\]\)\.filter\(\(source: any\) =>([\s\S]*?)\n  \);/i)?.[1] || '';

assert.ok(filterBlock, 'Chybí filtr dueSources v discover-leaflets.');
assert.match(
  filterBlock,
  /String\(source\.automation_mode \|\| ''\)\.toLocaleLowerCase\('cs'\) === 'automatic'/,
  'Generický discovery musí zpracovat pouze zdroje automation_mode=automatic.',
);
assert.doesNotMatch(
  filterBlock,
  /automation_mode \|\| ['"]automatic['"]/i,
  'Chybějící automation_mode nesmí potichu spadnout do generic crawleru.',
);
assert.match(
  filterBlock,
  /!SPECIALIZED_SOURCE_SLUGS\.has\(String\(source\.stores\?\.slug \|\| ''\)\)/,
  'Historická ochrana explicitně specializovaných slugů musí zůstat zachována.',
);

const eligible = (mode) => String(mode || '').toLocaleLowerCase('cs') === 'automatic';
assert.equal(eligible('automatic'), true);
assert.equal(eligible('AUTOMATIC'), true);
assert.equal(eligible('specialized'), false);
assert.equal(eligible('dedicated'), false);
assert.equal(eligible(null), false);
assert.equal(eligible(''), false);

console.log('Generic leaflet automation mode guard OK');
