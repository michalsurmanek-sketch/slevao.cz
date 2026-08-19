import fs from 'node:fs';

const path = 'supabase/migrations/20260819205244_optimize_public_offer_page_narrow_ranking.sql';
if (!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql = fs.readFileSync(path, 'utf8');

for (const needle of [
  'create or replace function public.get_public_offer_page_filtered',
  'with params as materialized',
  'matched as materialized',
  'ranked as materialized',
  'count(*) over()::bigint result_count',
  'row_number() over (',
  'page_ids as (',
  'join private.public_offer_search_cache c on c.offer_id=p.offer_id',
  'order by p.rn',
  "public.public_semantic_query_tag(p_query) semantic_tag",
  "x.mode='under50' and c.price<=50",
  "x.mode='under100' and c.price<=100",
]) {
  if (!sql.includes(needle)) throw new Error(`Missing narrow-ranking contract: ${needle}`);
}

const matched = sql.match(/matched as materialized \(([\s\S]*?)\), ranked as materialized/i)?.[1] || '';
if (!matched) throw new Error('Cannot find matched CTE.');
for (const forbidden of ['c.description','c.metadata','c.product_filter_tags','c.product_content_form','c.product_classification_confidence']) {
  if (matched.includes(forbidden)) throw new Error(`Wide payload leaked into ranking CTE: ${forbidden}`);
}

const lateJoin = sql.indexOf('join private.public_offer_search_cache c on c.offer_id=p.offer_id');
const pageIds = sql.indexOf('page_ids as (');
if (lateJoin < 0 || pageIds < 0 || lateJoin < pageIds) throw new Error('Full cache row must be joined only after page IDs are selected.');

if (/select\s+c\.\*\s+from\s+private\.public_offer_search_cache/i.test(matched)) {
  throw new Error('Ranking must not carry the full cache row.');
}
if (!/returns table\(offer jsonb, total_count bigint\)/i.test(sql)) throw new Error('Public RPC return contract changed.');

console.log('Public offer page narrow ranking OK');
