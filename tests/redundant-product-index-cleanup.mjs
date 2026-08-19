import fs from 'node:fs';

const path='supabase/migrations/20260819192826_drop_redundant_product_indexes.sql';
if(!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql=fs.readFileSync(path,'utf8');

for(const needle of [
  'drop index if exists public.products_ean_idx;',
  'drop index if exists public.products_normalized_name_idx;'
]) {
  if(!sql.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing redundant-index cleanup: ${needle}`);
}

for(const protectedIndex of [
  'products_ean_unique_idx',
  'products_normalized_name_trgm_idx',
  'idx_products_normalized_quantity_exact'
]) {
  const re=new RegExp(`drop\\s+index(?:\\s+if\\s+exists)?\\s+(?:public\\.)?${protectedIndex}`,'i');
  if(re.test(sql)) throw new Error(`Protected product index must not be dropped: ${protectedIndex}`);
}

const drops=(sql.match(/drop\s+index/gi)||[]).length;
if(drops!==2) throw new Error(`Expected exactly 2 dropped indexes, got ${drops}.`);
if(/delete\s+from|update\s+public\.products|alter\s+table|drop\s+table/i.test(sql)) throw new Error('Redundant-index cleanup must not mutate product data/schema beyond the two indexes.');

console.log('Redundant product index cleanup guard OK');
