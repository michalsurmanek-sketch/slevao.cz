import fs from 'node:fs';

const bolaPath = 'supabase/migrations/20260818203243_fix_shopping_list_share_update_bola.sql';
const serializationPath = 'supabase/migrations/20260828152611_serialize_shopping_list_share_creation.sql';
const triggerAclPath = 'supabase/migrations/20260828152759_restrict_shopping_trigger_function_execute.sql';
const directWriteAclPath = 'supabase/migrations/20260828153552_restrict_direct_shopping_share_writes.sql';
const shoppingRuntimePath = 'assets/shopping-list.js';
for (const path of [bolaPath, serializationPath, triggerAclPath, directWriteAclPath, shoppingRuntimePath]) {
  if (!fs.existsSync(path)) throw new Error(`Missing file: ${path}`);
}

const sql = fs.readFileSync(bolaPath, 'utf8');
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

const serialization = fs.readFileSync(serializationPath, 'utf8');
for (const needle of [
  'create unique index if not exists shopping_list_shares_one_active_per_list_idx',
  'on public.shopping_list_shares (shopping_list_id)',
  'where revoked_at is null',
  'create or replace function public.create_shopping_list_share',
  'and user_id = v_user',
  'and is_archived = false',
  'for update',
  'set revoked_at = now()',
  'where shopping_list_id = p_list_id',
  'and revoked_at is null',
  "encode(extensions.gen_random_bytes(24), 'hex')",
  "encode(extensions.digest(v_token, 'sha256'), 'hex')",
  'revoke all on function public.create_shopping_list_share(uuid,text,integer) from public, anon',
  'grant execute on function public.create_shopping_list_share(uuid,text,integer) to authenticated, service_role'
]) {
  if (!serialization.toLowerCase().includes(needle.toLowerCase())) throw new Error(`Missing serialized share creation guard: ${needle}`);
}

const lockPos = serialization.toLowerCase().indexOf('for update');
const revokePos = serialization.toLowerCase().indexOf('set revoked_at = now()');
const insertPos = serialization.toLowerCase().indexOf('insert into public.shopping_list_shares');
if (!(lockPos >= 0 && revokePos > lockPos && insertPos > revokePos)) {
  throw new Error('Share creation must lock the owned list, revoke active shares, then insert the replacement token.');
}
if (/grant\s+execute[\s\S]*\b(?:public|anon)\b/i.test(serialization)) {
  throw new Error('Anonymous/public role must not execute create_shopping_list_share.');
}

const triggerAcl = fs.readFileSync(triggerAclPath, 'utf8');
for (const fn of ['guard_shopping_list_selected_offer()', 'validate_shopping_purchase_snapshot()']) {
  const escaped = fn.replace(/[()]/g, '\\$&');
  const revoke = new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${escaped}\\s+from\\s+public,\\s*anon,\\s*authenticated`, 'i');
  const grant = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped}\\s+to\\s+postgres,\\s*service_role`, 'i');
  if (!revoke.test(triggerAcl)) throw new Error(`Public execute not revoked from trigger function: ${fn}`);
  if (!grant.test(triggerAcl)) throw new Error(`Trusted execute not retained for trigger function: ${fn}`);
}
if (/grant\s+execute[\s\S]*\b(?:anon|authenticated|public)\b/i.test(triggerAcl)) {
  throw new Error('Shopping trigger ACL migration must not grant direct execute to public client roles.');
}

const directWriteAcl = fs.readFileSync(directWriteAclPath, 'utf8');
for (const privilege of ['insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
  if (!new RegExp(`revoke[\\s\\S]*\\b${privilege}\\b[\\s\\S]*on\\s+table\\s+public\\.shopping_list_shares[\\s\\S]*from\\s+authenticated`, 'i').test(directWriteAcl)) {
    throw new Error(`Authenticated direct shopping share privilege is not revoked: ${privilege}`);
  }
}
if (/revoke[\s\S]*\bselect\b/i.test(directWriteAcl)) {
  throw new Error('Direct-write hardening must preserve shopping_list_shares SELECT compatibility.');
}

const runtime = fs.readFileSync(shoppingRuntimePath, 'utf8');
for (const rpc of ['create_shopping_list_share', 'get_shared_shopping_list', 'get_shared_shopping_list_revision', 'mutate_shared_shopping_list']) {
  if (!new RegExp(`\\.rpc\\(['\"]${rpc}['\"]`, 'i').test(runtime)) {
    throw new Error(`Shopping runtime no longer uses required share RPC: ${rpc}`);
  }
}
if (/\.from\(['\"]shopping_list_shares['\"]\)/i.test(runtime)) {
  throw new Error('Shopping runtime must not bypass share RPCs with direct shopping_list_shares table access.');
}

console.log('Shopping list share BOLA, serialized token replacement, RPC-only writes, and trigger ACL guards OK');
