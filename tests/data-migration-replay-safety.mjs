import fs from 'node:fs';

const exactBatches = [
  ['20260818200839_deactivate_safe_albert_v4_unbranded_duplicates_b.sql', 4443, 9],
  ['20260818201017_deactivate_safe_albert_v4_unbranded_duplicates_z.sql', 3919, 10],
  ['20260818201050_deactivate_safe_albert_v4_unbranded_duplicates_s.sql', 4340, 11],
  ['20260818201119_deactivate_safe_albert_v4_unbranded_duplicates_p.sql', 3653, 17],
  ['20260818201158_deactivate_safe_albert_v4_unbranded_duplicates_r.sql', 2738, 9],
  ['20260818201223_deactivate_safe_albert_v4_unbranded_duplicates_tuvw.sql', 4252, 17],
  ['20260818201246_deactivate_safe_albert_v4_unbranded_duplicates_jl.sql', 4314, 11],
  ['20260818201331_deactivate_safe_albert_v4_unbranded_duplicates_mo.sql', 4685, 17],
  ['20260818201357_deactivate_safe_albert_v4_unbranded_duplicates_acdf.sql', 3222, 17],
  ['20260818201421_deactivate_safe_albert_v4_unbranded_duplicates_ghk.sql', 3189, 13],
];

for (const [file, rows, clusters] of exactBatches) {
  const path = `supabase/migrations/${file}`;
  const sql = fs.readFileSync(path, 'utf8');
  const compact = sql.replace(/\s+/g, '');
  if (!compact.includes('ifnot(v_count=0andv_clusters=0)and(')) {
    throw new Error(`${file}: clean/no-data replay must be a no-op.`);
  }
  if (!compact.includes(`v_count<>${rows}`) || !compact.includes(`v_clusters<>${clusters}`)) {
    throw new Error(`${file}: production drift guard ${rows}/${clusters} disappeared.`);
  }
}

const branded = fs.readFileSync(
  'supabase/migrations/20260818191857_deactivate_safe_albert_v4_branded_duplicates_v1.sql',
  'utf8',
).replace(/\s+/g, '');
if (!branded.includes('ifnot(v_count=0andv_clusters=0)and(v_count<4000orv_count>5000orv_clusters<>12)then')) {
  throw new Error('Branded Albert cleanup must allow 0/0 replay while preserving the 4000..5000 / 12-cluster production guard.');
}

const repair = fs.readFileSync(
  'supabase/migrations/20260818194000_repair_albert_v1_private_taxonomy_refs.sql',
  'utf8',
).replace(/\s+/g, '');
if (!repair.includes('ifnot(v_candidates=0andv_logs=0andv_visual=0andv_inactive_canonicals=0)and(')) {
  throw new Error('Albert private-ref repair must allow an empty clean-database replay.');
}
for (const needle of ['v_candidates<>9','v_logs<>2','v_visual<>0','v_inactive_canonicals<>0']) {
  if (!repair.includes(needle)) throw new Error(`Private-ref production guard disappeared: ${needle}`);
}

console.log('Data migration replay safety OK: empty database is a no-op; partial drift still aborts');
