import fs from 'node:fs';
const path='supabase/migrations/20260818175923_classify_home_subcategory_exact_v1.sql';
const sql=fs.readFileSync(path,'utf8');
for (const token of [
  "classification_source='home-subcategory-exact-v1'",
  "p.category_id is null",
  "public.infer_public_filter_group(name,null)='home'",
  "hrnec|panev|rucnik|povleceni|stul|zidle|drez|svitidlo|zarovka",
  "dlazba|naradi|aku|bruska|vrtaci|profesional|professional|zahradni",
  "slug='domacnost'",
]) if(!sql.includes(token)) throw new Error(`missing guard: ${token}`);
if(sql.includes("category_id='")) throw new Error('hardcoded category UUID detected');
console.log('home subcategory migration guards: ok');
