import fs from 'node:fs';

const classify = fs.readFileSync('supabase/migrations/20260818182051_classify_manual_alias_consensus_v1.sql','utf8');
const harden = fs.readFileSync('supabase/migrations/20260818182450_harden_generic_product_aliases_v1.sql','utf8');

for (const needle of [
  "classification_source='manual-alias-consensus-v1'",
  "classification_confidence=0.99",
  "where category_id is null",
  "PARKSIDE Pracovní kraťasy 48 - 58",
  "Polštář z umělého vlákna 70x80 KLEINEGGA"
]) {
  if (!classify.includes(needle)) throw new Error(`Missing reviewed alias classification guard: ${needle}`);
}

for (const needle of [
  "create or replace function public.product_label_is_specific",
  "ruzne druhy",
  "vice druhu",
  "dle nabidky",
  "dle vyberu",
  "delete from public.product_aliases"
]) {
  if (!harden.includes(needle)) throw new Error(`Missing generic alias hardening: ${needle}`);
}

if (!harden.includes("normalized_value ~ '^(ruzne druhy|vice druhu|vybrane druhy|dle nabidky|dle vyberu)( |$)'")) {
  throw new Error('Generic alias prefix rejection is missing');
}
if (/K-Jarmark Perník/.test(classify)) throw new Error('Known unsafe Pernik alias evidence must not be backfilled');

console.log('product alias identity hardening OK');
