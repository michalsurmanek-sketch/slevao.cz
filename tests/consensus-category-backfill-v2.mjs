import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260818150953_classify_consensus_public_groups_v2.sql','utf8');
for (const needle of ["in ('drinks','drugstore','pharmacy')","when 'drinks' then 'napoje'","when 'drugstore' then 'drogerie'","when 'pharmacy' then 'lekarna'","p.category_id is null","classification_source = 'public-group-consensus-v2'"]) {
  if (!sql.includes(needle)) throw new Error(`Missing consensus v2 guard: ${needle}`);
}
if (sql.includes("'food'")) throw new Error('Food must remain excluded from consensus v2 backfill.');
console.log('consensus category backfill v2 regression checks passed');
