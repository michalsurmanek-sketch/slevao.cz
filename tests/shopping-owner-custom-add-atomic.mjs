import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migrationPath = 'supabase/migrations/20260827215500_atomic_owner_custom_item_add.sql';
const sql = readFileSync(new URL(migrationPath, root), 'utf8');

for (const needle of [
  'create table if not exists public.shopping_list_add_mutations',
  'primary key (user_id, mutation_id)',
  'alter table public.shopping_list_add_mutations enable row level security;',
  'revoke all on table public.shopping_list_add_mutations from public, anon, authenticated;',
  'create or replace function public.add_own_shopping_list_custom_item(',
  'security definer',
  "set search_path = ''",
  'v_user_id uuid := auth.uid();',
  "errcode = '42501'",
  'if p_mutation_id is null then',
  'on conflict (user_id) where is_archived = false do nothing',
  'from public.shopping_lists sl',
  'for update;',
  "m.created_at < now() - interval '30 days'",
  'on conflict (user_id, mutation_id) do nothing;',
  'v_claimed_mutation := found;',
  'if not v_claimed_mutation then',
  "'duplicate', true",
  'perform pg_advisory_xact_lock(',
  "'slevao-owner-shopping-list-custom:'",
  "lower(trim(coalesce(i.custom_name, ''))) = lower(v_name)",
  'else least(999, i.quantity + v_quantity)',
  'is_completed = false',
  'set item_id = v_item.id',
  "'duplicate', false",
  'revoke all on function public.add_own_shopping_list_custom_item(text, numeric, text, uuid) from public;',
  'revoke all on function public.add_own_shopping_list_custom_item(text, numeric, text, uuid) from anon;',
  'grant execute on function public.add_own_shopping_list_custom_item(text, numeric, text, uuid) to authenticated;',
]) {
  assert.ok(sql.includes(needle), `Chybí owner custom add kontrakt: ${needle}`);
}

const parentLock = sql.indexOf('from public.shopping_lists sl', sql.indexOf('-- Serialize all owner writes'));
const mutationClaim = sql.indexOf('insert into public.shopping_list_add_mutations(', parentLock);
const duplicateGuard = sql.indexOf('if not v_claimed_mutation then', mutationClaim);
const advisoryLock = sql.indexOf('perform pg_advisory_xact_lock(', duplicateGuard);
const itemUpdate = sql.indexOf('update public.shopping_list_items i', advisoryLock);
const mutationCommit = sql.indexOf('set item_id = v_item.id', itemUpdate);

assert.ok(parentLock >= 0, 'Owner add nezamyká rodičovský seznam.');
assert.ok(mutationClaim > parentLock, 'Mutation token se zapisuje před parent lockem.');
assert.ok(duplicateGuard > mutationClaim, 'Idempotentní duplicate guard chybí za mutation claimem.');
assert.ok(advisoryLock > duplicateGuard, 'Identity advisory lock se bere před idempotency kontrolou.');
assert.ok(itemUpdate > advisoryLock, 'Množství se mění před identity lockem.');
assert.ok(mutationCommit > itemUpdate, 'Mutation log se označuje jako aplikovaný před změnou položky.');

assert.ok(!/grant\s+(?:select|insert|update|delete|all).*shopping_list_add_mutations.*authenticated/is.test(sql), 'Interní mutation tabulka nesmí být přímo dostupná authenticated klientům.');
assert.ok(!sql.includes('grant execute on function public.add_own_shopping_list_custom_item(text, numeric, text, uuid) to anon'), 'Atomický owner RPC nesmí být dostupný anonymním uživatelům.');

console.log('Idempotent owner custom item add migration contract OK');
