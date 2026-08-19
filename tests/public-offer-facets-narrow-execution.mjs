import fs from 'node:fs';

const path = 'supabase/migrations/20260819194525_narrow_public_offer_facets_execution.sql';
if (!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql = fs.readFileSync(path, 'utf8').toLowerCase();

for (const needle of [
  'create or replace function public.get_public_offer_facets',
  'common as materialized',
  "set plan_cache_mode to 'force_custom_plan'",
  "'stores',coalesce((",
  "'groups',coalesce((",
  'count(*)::bigint total',
  'count(*) filter(where c.valid_from<=x.today)::bigint current_count',
  'count(*) filter(where c.valid_from>x.today)::bigint upcoming_count',
]) {
  if (!sql.includes(needle)) throw new Error(`Missing narrow facet guard: ${needle}`);
}

for (const forbidden of [
  'select c.* from private.public_offer_search_cache',
  'drop function',
  'drop materialized view',
  'drop index',
]) {
  if (sql.includes(forbidden)) throw new Error(`Facet migration reintroduces forbidden pattern: ${forbidden}`);
}

const commonPos = sql.indexOf('common as materialized');
const totalPos = sql.indexOf('total_rows as', commonPos);
if (commonPos < 0 || totalPos < 0 || commonPos > totalPos) throw new Error('Narrow common CTE must feed facet aggregations.');

const commonSlice = sql.slice(commonPos, totalPos);
for (const wideField of ['metadata','product_name','product_brand','product_filter_tags','description','image_url as product_image_url']) {
  if (commonSlice.includes(wideField)) throw new Error(`Facet common CTE must stay narrow; found ${wideField}.`);
}

for (const filterNeedle of [
  "x.query_text is null",
  "x.semantic_tag is not null and c.semantic_tags @> array[x.semantic_tag]",
  "x.mode='recommended'",
  "x.mode='food'",
  "x.mode='ending'",
  "x.mode='under50'",
  "x.mode='under100'",
]) {
  if (!commonSlice.includes(filterNeedle)) throw new Error(`Facet filter contract missing: ${filterNeedle}`);
}

console.log('Public offer facets narrow execution guard OK');
