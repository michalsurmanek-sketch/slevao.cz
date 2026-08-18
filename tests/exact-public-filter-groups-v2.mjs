import fs from 'node:fs';
const path='supabase/migrations/20260818175546_classify_exact_public_filter_groups_v2.sql';
const sql=fs.readFileSync(path,'utf8');
for (const token of [
  "classification_source='public-filter-group-exact-v2'",
  "p.category_id is null",
  "public.infer_public_filter_group(name,null)",
  "in ('drinks','drugstore','pets')",
  "when 'drinks' then 'napoje'",
  "when 'drugstore' then 'drogerie'",
  "when 'pets' then 'zvirata'",
]) if(!sql.includes(token)) throw new Error(`missing guard: ${token}`);
for (const forbidden of ["when 'food'","when 'home'","when 'fashion'","when 'electronics'","when 'pharmacy'"]) if(sql.includes(forbidden)) throw new Error(`unsafe mapping introduced: ${forbidden}`);
console.log('exact public filter groups v2 guards: ok');
