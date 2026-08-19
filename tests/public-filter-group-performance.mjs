import fs from 'node:fs';

const path='supabase/migrations/20260819191533_optimize_infer_public_filter_group.sql';
if(!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql=fs.readFileSync(path,'utf8');

for(const needle of [
  'create or replace function public.infer_public_filter_group',
  'immutable',
  'parallel safe',
  "n text := public.normalize_text(coalesce(p_name,''))",
  "when p_category_slug='drogerie' then 'drugstore'",
  "when p_category_slug='elektronika' then 'electronics'",
  "when p_category_slug='moda' then 'fashion'",
  "when p_category_slug='lekarna' then 'pharmacy'",
  "when p_category_slug='zvirata' then 'pets'",
  "when p_category_slug='zahrada' then 'garden'",
  "else 'other'"
]) {
  if(!sql.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing filter-group performance guard: ${needle}`);
}

const normalizeCalls=(sql.match(/public\.normalize_text\s*\(/gi)||[]).length;
if(normalizeCalls!==1) throw new Error(`Filter group inference must normalize input exactly once, got ${normalizeCalls}.`);
if(/drop\s+function|alter\s+table|delete\s+from|update\s+public\./i.test(sql)) throw new Error('Filter-group performance migration must only replace the function.');

console.log('Public filter group performance guard OK');
