import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20260903213902_accept_czech_garlic_clove_forms.sql', root), 'utf8');

assert.match(migration, /pg_get_functiondef\('public\.get_public_shopping_list_candidates\(text\[\],integer\)'::regprocedure\)/,
  'Garlic grammar migration must update the current shopping candidate RPC definition.');
assert.match(migration, /'kg\|g\|ml\|l\|ks\|balení\|stroužky'/,
  'Migration must target the previous recipe suffix contract exactly.');
assert.match(migration, /'kg\|g\|ml\|l\|ks\|balení\|stroužek\|stroužky\|stroužků'/,
  'Recipe suffix parser must accept Czech singular, 2–4 plural, and 5+ plural garlic clove forms.');
assert.match(migration, /execute definition;/,
  'Updated RPC definition must be executed inside the migration.');

console.log('Czech garlic clove recipe suffix migration OK');
