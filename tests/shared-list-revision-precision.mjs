import fs from 'node:fs';

const path = 'supabase/migrations/20260818202826_fix_shared_list_revision_precision.sql';
if (!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql = fs.readFileSync(path, 'utf8');

for (const fn of ['get_shared_shopping_list_revision','get_shared_shopping_list']) {
  if (!sql.includes(`function public.${fn}`)) throw new Error(`Missing ${fn} replacement.`);
}

for (const needle of [
  "position('extract(epoch from v_max_updated)::bigint' in v_revision_def)=0",
  "position('extract(epoch from v_max_created)::bigint' in v_revision_def)=0",
  "position('extract(epoch from v_max_updated)::bigint' in v_full_def)=0",
  "position('extract(epoch from v_max_created)::bigint' in v_full_def)=0",
  "coalesce(extract(epoch from v_max_updated)::text,'0')",
  "coalesce(extract(epoch from v_max_created)::text,'0')",
  'security definer',
  'select * into v_share from public.resolve_shopping_list_share(p_token)',
  "'revision',v_revision"
]) {
  if (!sql.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing shared-list precision guard: ${needle}`);
}

const bigintWrites = [...sql.matchAll(/v_revision\s*:=([\s\S]*?);/gi)]
  .some((match) => /extract\s*\(\s*epoch[\s\S]*?::bigint/i.test(match[1]));
if (bigintWrites) throw new Error('Revision generation must not truncate timestamps to bigint seconds.');

for (const forbidden of [
  /revoke\s+execute/i,
  /grant\s+execute/i,
  /drop\s+function/i,
  /drop\s+table/i,
  /delete\s+from\s+public\.shopping_list/i,
  /update\s+public\.shopping_list_items/i
]) {
  if (forbidden.test(sql)) throw new Error(`Precision migration contains forbidden behavior: ${forbidden}`);
}

console.log('Shared list revision precision OK');
