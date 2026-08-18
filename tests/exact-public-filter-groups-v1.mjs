import fs from 'node:fs';

const path = 'supabase/migrations/20260818174434_classify_exact_public_filter_groups_v1.sql';
const sql = fs.readFileSync(path, 'utf8');

for (const token of [
  "classification_source='public-filter-group-exact-v1'",
  "p.category_id is null",
  "public.infer_public_filter_group(p.name,null)",
  "in ('drinks','drugstore','fashion','garden','pets')",
  "when 'drinks' then 'napoje'",
  "when 'drugstore' then 'drogerie'",
  "when 'fashion' then 'moda'",
  "when 'garden' then 'zahrada'",
  "when 'pets' then 'zvirata'",
]) {
  if (!sql.includes(token)) throw new Error(`missing guard: ${token}`);
}

for (const forbidden of ["when 'food'", "when 'home'", "when 'electronics'", "when 'pharmacy'", "when 'auto'"]) {
  if (sql.includes(forbidden)) throw new Error(`unsafe broad mapping introduced: ${forbidden}`);
}

console.log('exact public filter group migration guards: ok');
