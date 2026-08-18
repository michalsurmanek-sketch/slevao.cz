import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260818150628_harden_public_filter_group_inference_v3.sql', 'utf8');

if (!sql.includes('pletova|telove|avivaz')) {
  throw new Error('Body lotion must be handled before generic food milk matching.');
}
if (!sql.includes("then 'drugstore'")) {
  throw new Error('Drugstore classifier branch is missing.');
}
if (!sql.includes('mleko|jogurt|tvaroh')) {
  throw new Error('Food dairy classifier must remain intact for actual dairy products.');
}

console.log('public filter group inference v3 regression checks passed');
