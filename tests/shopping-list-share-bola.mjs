import fs from 'node:fs';

const path = 'supabase/migrations/20260818203243_fix_shopping_list_share_update_bola.sql';
if (!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql = fs.readFileSync(path, 'utf8');

for (const needle of [
  "policyname='shopping_list_shares_owner_update'",
  'drop policy if exists shopping_list_shares_owner_update on public.shopping_list_shares;',
  'create policy shopping_list_shares_owner_update',
  'for update',
  'to authenticated',
  'created_by = (select auth.uid())',
  'from public.shopping_lists sl',
  'sl.id = shopping_list_shares.shopping_list_id',
  'sl.user_id = (select auth.uid())',
  'using (',
  'with check ('
]) {
  if (!sql.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing shopping-list share BOLA guard: ${needle}`);
}

const ownershipCheck = /exists\s*\(\s*select\s+1\s+from\s+public\.shopping_lists\s+sl[\s\S]*?sl\.id\s*=\s*shopping_list_shares\.shopping_list_id[\s\S]*?sl\.user_id\s*=\s*\(select\s+auth\.uid\(\)\)/gi;
const matches = sql.match(ownershipCheck) || [];
if (matches.length < 2) throw new Error('Both USING and WITH CHECK must verify ownership of the target shopping list.');

for (const forbidden of [
  /using\s*\(\s*true\s*\)/i,
  /with\s+check\s*\(\s*true\s*\)/i,
  /disable\s+row\s+level\s+security/i,
  /alter\s+table[\s\S]*disable\s+row\s+level\s+security/i,
  /grant\s+all/i,
  /delete\s+from\s+public\.shopping_list/i,
  /update\s+public\.shopping_list_shares\s+set/i
]) {
  if (forbidden.test(sql)) throw new Error(`BOLA migration contains forbidden behavior: ${forbidden}`);
}

console.log('Shopping list share update ownership policy OK');
