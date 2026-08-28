import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const path = 'supabase/migrations/20260828121000_canonical_shopping_custom_item_key.sql';
const sql = readFileSync(new URL(path, root), 'utf8');
const lower = sql.toLowerCase();

for (const needle of [
  'create or replace function public.shopping_custom_name_key(p_name text)',
  "lower(public.unaccent(coalesce(p_name, '')))",
  "'[^a-z0-9]+'",
  "alter table public.shopping_list_items\n  add column if not exists custom_key text;",
  'create or replace function public.set_shopping_list_item_custom_key()',
  'before insert or update of custom_name, product_id',
  'new.custom_key := public.shopping_custom_name_key(new.custom_name);',
  'group by shopping_list_id, custom_key',
  "raise exception 'Canonical shopping custom-name collision detected; migration aborted.';",
  'drop index if exists public.shopping_list_items_one_custom_name_per_list_uidx;',
  'create unique index if not exists shopping_list_items_one_custom_key_per_list_uidx',
  'on public.shopping_list_items (shopping_list_id, custom_key)',
  'add constraint shopping_list_items_custom_key_check',
]) {
  assert.ok(sql.includes(needle), `Chybí canonical custom-key schema kontrakt: ${needle}`);
}

const functionNames = [
  'add_own_shopping_list_custom_item',
  'increment_own_shopping_list_offer',
  'mutate_shared_shopping_list',
  'repeat_shopping_purchase',
];

for (let index = 0; index < functionNames.length; index++) {
  const name = functionNames[index];
  const start = lower.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `Migrace nedefinuje ${name}.`);
  const nextStarts = functionNames
    .slice(index + 1)
    .map((candidate) => lower.indexOf(`create or replace function public.${candidate}`, start + 1))
    .filter((position) => position > start);
  const end = nextStarts.length ? Math.min(...nextStarts) : lower.length;
  const body = lower.slice(start, end);
  assert.ok(body.includes('shopping_custom_name_key'), `${name} nepoužívá kanonickou normalizaci.`);
  assert.ok(body.includes('custom_key'), `${name} neslučuje vlastní položky přes custom_key.`);
  assert.ok(!body.includes("lower(trim(coalesce(i.custom_name, '')))"), `${name} stále používá staré lower(trim) slučování.`);
  assert.ok(!body.includes('lower(btrim(custom_name))'), `${name} stále používá staré lower(btrim) slučování.`);
}

const ownerStart = lower.indexOf('create or replace function public.add_own_shopping_list_custom_item');
const offerStart = lower.indexOf('create or replace function public.increment_own_shopping_list_offer');
const sharedStart = lower.indexOf('create or replace function public.mutate_shared_shopping_list');
const repeatStart = lower.indexOf('create or replace function public.repeat_shopping_purchase');
const ownerBody = lower.slice(ownerStart, offerStart);
const sharedBody = lower.slice(sharedStart, repeatStart);
const repeatBody = lower.slice(repeatStart);
assert.ok(ownerBody.includes('security definer'), 'Owner custom-add změnil bezpečnostní model mimo rozsah normalizace.');
assert.ok(sharedBody.includes('security definer'), 'Shared edit musí zachovat tokenový SECURITY DEFINER model.');
assert.ok(repeatBody.includes('security invoker'), 'Repeat purchase musí zůstat SECURITY INVOKER.');
assert.ok(sharedBody.includes("if v_share.permission <> 'edit' then"), 'Canonicalizace ztratila shared edit permission guard.');

const norm = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
for (const variants of [
  ['Chléb', 'chleb', ' CHLÉB '],
  ['Rohlíky', 'rohliky', 'ROHLÍKY'],
  ['Jablka 1 kg', 'jablka-1 kg', 'JÁBLKA 1 KG'],
]) {
  const keys = new Set(variants.map(norm));
  assert.equal(keys.size, 1, `Frontend canonical key se rozchází pro varianty ${variants.join(' / ')}.`);
}

console.log('Shopping custom item canonical key contract OK');
