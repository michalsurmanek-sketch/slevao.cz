import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20260828143145_make_public_semantic_match_wrapper_invoker.sql', root), 'utf8');

for (const needle of [
  'grant execute on function public.public_semantic_offer_matches_normalized(text, text[], text, text) to anon;',
  'grant execute on function public.public_semantic_offer_matches_normalized(text, text[], text, text) to authenticated;',
  'alter function public.public_semantic_offer_matches(text, text[], text, text) security invoker;',
]) {
  assert.ok(migration.includes(needle), `Chybí semantic match security guard: ${needle}`);
}

for (const forbidden of [
  /security\s+definer/i,
  /grant\s+execute[^;]+to\s+public/i,
  /create\s+or\s+replace\s+function/i,
  /update\s+public\./i,
  /delete\s+from\s+public\./i,
]) {
  assert.ok(!forbidden.test(migration), `Semantic match security migration obsahuje nežádoucí změnu: ${forbidden}`);
}

console.log('Public semantic match wrapper uses invoker security');
