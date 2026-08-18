import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260818145635_harden_public_filter_group_inference_v2.sql', 'utf8');

const required = [
  "when p_category_slug = 'auto' then 'auto'",
  "pletova|ustni|micelarni",
  "dolce gusto|nespresso|tassimo",
  "magnesium|calcium|probiot|dr max",
  "!~ '\\m(sumiv|vitamin|magnesium|calcium|dr max|lecivo|lekarn)\\M'",
  "praci|mycka",
];

for (const needle of required) {
  if (!sql.includes(needle)) throw new Error(`Missing classifier hardening rule: ${needle}`);
}

if (/\\m\(vitamin\|tablety\|kapsle\|lecivo/.test(sql)) {
  throw new Error('Generic tablet/capsule pharmacy rule reintroduced.');
}

if (/\\m\(pivo[^\n]*\|voda\|/.test(sql)) {
  throw new Error('Generic voda token must not be in the unconditional drinks rule.');
}

console.log('public filter group inference v2 regression checks passed');
