import fs from 'node:fs';

const path='supabase/migrations/20260819191103_optimize_public_offer_semantic_tags.sql';
if(!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql=fs.readFileSync(path,'utf8');

for(const needle of [
  'create or replace function public.public_offer_semantic_tags(p_search text)',
  'immutable',
  'parallel safe',
  "s text := public.normalize_text(coalesce(p_search,''))",
  "tags:=array_append(tags,'beer')",
  "tags:=array_append(tags,'milk')",
  "tags:=array_append(tags,'bread')",
  "tags:=array_append(tags,'meat')",
  "tags:=array_append(tags,'fruit_fresh')",
  "tags:=array_append(tags,'veg_fresh')",
  "tags:=array_append(tags,'veg_preserved')",
]) {
  if(!sql.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing semantic-tag optimization guard: ${needle}`);
}

if(/public_search_matches\s*\(/i.test(sql)) throw new Error('Optimized semantic tags must not call public_search_matches repeatedly.');
const normalizeCalls=(sql.match(/public\.normalize_text\s*\(/gi)||[]).length;
if(normalizeCalls!==1) throw new Error(`Semantic tags must normalize input exactly once, got ${normalizeCalls}.`);
if(/drop\s+function|alter\s+table|delete\s+from|update\s+public\./i.test(sql)) throw new Error('Semantic-tag performance migration must not mutate schema/data beyond function replacement.');

console.log('Public offer semantic tags performance guard OK');
await import('./public-semantic-match-security.mjs');
