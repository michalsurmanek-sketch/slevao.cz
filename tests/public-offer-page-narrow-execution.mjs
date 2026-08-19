import fs from 'node:fs';

const path = 'supabase/migrations/20260819193747_narrow_public_offer_page_execution.sql';
if (!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql = fs.readFileSync(path, 'utf8').toLowerCase();

for (const needle of [
  'create or replace function public.get_public_offer_page_filtered',
  'matched as materialized',
  'page_ids as',
  'select count(*)::bigint total_count from matched',
  'join private.public_offer_search_cache pg on pg.offer_id=p.offer_id',
  "set plan_cache_mode to 'force_custom_plan'",
  'limit (select row_limit from params)',
  'offset (select row_offset from params)',
]) {
  if (!sql.includes(needle)) throw new Error(`Missing narrow offer-page guard: ${needle}`);
}

for (const forbidden of [
  'count(*) over()',
  'select c.* from private.public_offer_search_cache c cross join params',
  'drop function',
  'drop materialized view',
  'drop index',
]) {
  if (sql.includes(forbidden)) throw new Error(`Narrow offer-page migration reintroduces forbidden pattern: ${forbidden}`);
}

const pagePos = sql.indexOf('page_ids as');
const jsonPos = sql.indexOf('select jsonb_build_object(', pagePos);
const finalFromPos = sql.indexOf('from page_ids p', jsonPos);
const fullJoinPos = sql.indexOf('join private.public_offer_search_cache pg on pg.offer_id=p.offer_id', finalFromPos);
if (pagePos < 0 || jsonPos < 0 || finalFromPos < 0 || fullJoinPos < 0 || !(pagePos < jsonPos && jsonPos < finalFromPos && finalFromPos < fullJoinPos)) {
  throw new Error('Full cache payload must only be resolved in the final SELECT after page_ids.');
}

const narrowSlice = sql.slice(pagePos, jsonPos);
for (const wideField of ['metadata','product_name','product_brand','product_filter_tags','store_logo_url','category_name']) {
  if (narrowSlice.includes(wideField)) throw new Error(`page_ids must stay narrow; found ${wideField}.`);
}

console.log('Public offer page narrow execution guard OK');
