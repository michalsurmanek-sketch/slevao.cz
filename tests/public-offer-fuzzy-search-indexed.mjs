import fs from 'node:fs';

const path = 'supabase/migrations/20260819210326_index_public_offer_fuzzy_search_v3.sql';
if (!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql = fs.readFileSync(path, 'utf8').toLowerCase();

for (const needle of [
  'create or replace function public.get_public_offer_page_filtered',
  'create or replace function public.get_public_offer_facets',
  "set_config('pg_trgm.similarity_threshold','0.24',true)",
  "c.normalized_search like '%'||x.query_text||'%'",
  'c.normalized_product_search % x.query_text',
  'matched as materialized',
  'common as materialized',
]) {
  if (!sql.includes(needle)) throw new Error(`Missing indexed fuzzy-search guard: ${needle}`);
}

for (const forbidden of [
  'similarity(c.normalized_product_search,x.query_text)>=0.24',
  "public.normalize_text(c.store_name) like '%'||x.query_text||'%'",
  "public.normalize_text(c.category_name) like '%'||x.query_text||'%'",
  'set pg_trgm.similarity_threshold',
  'drop function',
  'drop index',
]) {
  if (sql.includes(forbidden)) throw new Error(`Indexed fuzzy search reintroduced slow/unsafe pattern: ${forbidden}`);
}

const pageStart = sql.indexOf('create or replace function public.get_public_offer_page_filtered');
const facetsStart = sql.indexOf('create or replace function public.get_public_offer_facets');
if (pageStart < 0 || facetsStart < 0 || pageStart >= facetsStart) throw new Error('Page/facets function order is invalid.');

for (const slice of [sql.slice(pageStart, facetsStart), sql.slice(facetsStart)]) {
  if (!slice.includes("set_config('pg_trgm.similarity_threshold','0.24',true)")) throw new Error('Each public search RPC must set a transaction-local trigram threshold.');
  if (!slice.includes('c.normalized_search like')) throw new Error('Each public search RPC must use the indexed normalized_search substring path.');
  if (!slice.includes('c.normalized_product_search % x.query_text')) throw new Error('Each public search RPC must use the indexed trigram similarity operator.');
}

console.log('Public offer fuzzy search indexed path OK');
