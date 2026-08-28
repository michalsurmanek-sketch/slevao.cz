import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const unaccent = readFileSync(new URL('supabase/migrations/20260828164619_move_unaccent_extension_out_of_public.sql', root), 'utf8');
const trgm = readFileSync(new URL('supabase/migrations/20260828164856_move_pg_trgm_extension_out_of_public.sql', root), 'utf8');

assert.ok(unaccent.includes('alter extension unaccent set schema extensions;'), 'unaccent extension se nepřesouvá do extensions.');
assert.ok(unaccent.includes("select extensions.unaccent(value)"), 'Textový unaccent wrapper nevolá přesně extensions.unaccent.');
assert.ok(unaccent.includes('select extensions.unaccent(dictionary, value)'), 'Dvouparametrový unaccent wrapper nevolá extensions.unaccent.');
assert.ok(unaccent.includes("set search_path = ''"), 'unaccent wrapper nemá uzamčený search_path.');
assert.ok(unaccent.includes('revoke all on function public.unaccent(text) from public;'), 'unaccent wrapper nezavírá PUBLIC execute.');
assert.ok(unaccent.includes('grant execute on function public.unaccent(text) to anon, authenticated, service_role;'), 'unaccent wrapper nemá explicitní runtime role.');

assert.ok(trgm.includes('alter extension pg_trgm set schema extensions;'), 'pg_trgm extension se nepřesouvá do extensions.');
assert.ok(!/create\s+(or\s+replace\s+)?function\s+public\.(?:similarity|word_similarity|strict_word_similarity)/i.test(trgm), 'pg_trgm migration nesmí vracet trigram extension funkce do public.');

const expectedFunctions = [
  'public.get_public_offer_facets(boolean,text,numeric,numeric,boolean,text,text,text,text,text)',
  'public.get_public_offer_page_filtered(integer,integer,boolean,text,numeric,numeric,boolean,text,text,text,text,text,text)',
  'public.get_public_saved_offer_page(uuid[],integer,integer,text,numeric,numeric,boolean,text,text,text,text,text)',
  'public.public_search_matches(text,text)',
  'public.public_search_matches_v2(text,text)',
  'public.search_products_catalog(text,integer)',
  'public.search_public_offers(text,integer,integer,text,boolean)',
];

for (const fn of expectedFunctions) {
  const needle = `alter function ${fn}`;
  assert.ok(trgm.includes(needle), `pg_trgm migration neupravuje search_path funkce ${fn}.`);
}

assert.equal(
  (trgm.match(/set search_path = public, extensions, pg_temp;/g) || []).length,
  expectedFunctions.length,
  'Každá dotčená veřejná search funkce musí mít public, extensions, pg_temp search_path.',
);

console.log('Extension schema hardening OK: unaccent + pg_trgm');
