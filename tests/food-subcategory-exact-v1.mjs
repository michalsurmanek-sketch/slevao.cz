import fs from 'node:fs';
const path='supabase/migrations/20260818175133_classify_food_subcategories_exact_v1.sql';
const sql=fs.readFileSync(path,'utf8');
for (const token of [
  "classification_source='food-subcategory-exact-v1'",
  "p.category_id is null",
  "public.infer_public_filter_group(name,null)='food'",
  "then 'maso-ryby'",
  "then 'mlecne-vyrobky'",
  "then 'pecivo'",
  "then 'sladkosti'",
  "then 'trvanlive-potraviny'",
  "krmivo|kocky|psy|bujon|hotove jidlo|hotovy pokrm|s ryzi|konzerva pro",
  "zmrzlin|odlicovaci|telove|pletove|kosmeticke|cistici",
  "konturovaci|contour|stick|makeup|dermacol|wet n wild|kosmetick",
  "mlecna ryze|pro kocky|pro psy",
]) if(!sql.includes(token)) throw new Error(`missing guard: ${token}`);
if(sql.includes("category_id='")) throw new Error('hardcoded category UUID detected');
console.log('food subcategory migration guards: ok');
