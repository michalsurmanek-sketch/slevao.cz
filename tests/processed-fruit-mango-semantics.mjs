import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = new URL('../supabase/migrations/20260828081500_fix_processed_fruit_and_mango_semantics.sql', import.meta.url);
const sql = readFileSync(path, 'utf8');

for (const needle of [
  "public_offer_semantic_tags processed-fruit anchor drifted",
  "public_offer_semantic_tags mango anchor drifted",
  "public_semantic_query_tag mango anchor drifted",
  "chips[a-z0-9]*|sorbet[a-z0-9]*",
  "tags:=array_append(tags,'mango')",
  "when 'mango' then 'mango'",
  "public.public_offer_semantic_tags('Farmland Banánové chipsy')",
  "public.public_offer_semantic_tags('BALLINO Sorbet Mango/ Lesní směs')",
  "public.public_offer_semantic_tags('Banány')",
  "public.public_offer_semantic_tags('Mango')",
  "public.public_semantic_query_tag('mango')",
]) {
  assert.ok(sql.includes(needle), `Chybí semantic fruit/mango kontrakt: ${needle}`);
}

assert.ok(sql.includes("array['fruit_fresh','fruit_exotic','mango']::text[]"), 'Sorbet guard musí blokovat fresh/exotic/exact mango tagy.');
assert.ok(sql.includes("array['fruit_fresh','bananas']::text[]"), 'Čerstvé banány musí zůstat regresně chráněné.');
assert.ok(sql.includes("array['fruit_fresh','fruit_exotic','mango']::text[]"), 'Čerstvé mango musí mít kompletní semantic identitu.');
assert.ok(!/delete\s+from|update\s+public\.|alter\s+table|drop\s+function/i.test(sql), 'Semantic oprava nesmí měnit produktová data ani schéma tabulek.');

const replaceCalls = (sql.match(/replace\(v_/g) || []).length;
assert.equal(replaceCalls, 3, 'Migrace musí dělat přesně tři drift-guarded function replacements.');

console.log('Processed fruit and mango semantic migration guard OK');
