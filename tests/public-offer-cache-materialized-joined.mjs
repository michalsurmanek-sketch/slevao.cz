import fs from 'node:fs';

const build='supabase/migrations/20260819192209_build_materialized_public_offer_cache_candidate.sql';
const swap='supabase/migrations/20260819192302_swap_materialized_public_offer_cache.sql';
for(const path of [build,swap]) if(!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const a=fs.readFileSync(build,'utf8');
const b=fs.readFileSync(swap,'utf8');

for(const needle of [
  'create materialized view private.public_offer_search_cache_next as',
  'with joined as materialized',
  'public_offer_search_cache_next_offer_id_uidx',
  'public_offer_search_cache_next_semantic_tags_gin_idx',
  'public_offer_search_cache_next_search_trgm_idx',
  'grant all on table private.public_offer_search_cache_next to anon,authenticated,service_role'
]) if(!a.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing candidate cache guard: ${needle}`);

const indexCreates=(a.match(/create (?:unique )?index public_offer_search_cache_next_/gi)||[]).length;
if(indexCreates!==10) throw new Error(`Expected 10 candidate cache indexes, got ${indexCreates}.`);

for(const needle of [
  'alter materialized view private.public_offer_search_cache rename to public_offer_search_cache_previous',
  'alter materialized view private.public_offer_search_cache_next rename to public_offer_search_cache',
  'drop materialized view private.public_offer_search_cache_previous',
  'rename to public_offer_search_cache_offer_id_uidx',
  'rename to public_offer_search_cache_semantic_tags_gin_idx',
  'grant all on table private.public_offer_search_cache to anon,authenticated,service_role'
]) if(!b.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing cache swap guard: ${needle}`);

if(/drop materialized view private\.public_offer_search_cache;\s*create materialized view private\.public_offer_search_cache/i.test(a+b)) {
  throw new Error('Cache rebuild must use a side-by-side candidate, not a long destructive rebuild window.');
}

console.log('Public offer cache MATERIALIZED joined swap guard OK');
