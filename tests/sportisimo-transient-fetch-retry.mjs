import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260825203106_sportisimo_transient_fetch_retry.sql', 'utf8');

assert.match(sql, /retry_count',0/);
assert.match(sql, /v_retry < 2/);
assert.match(sql, /retry_scheduled/);
assert.match(sql, /retry_exhausted/);
assert.match(sql, /X-No-Cache','true'/);
assert.match(sql, /Cache-Control','no-cache'/);
assert.match(sql, /health_status='running'.*automatický retry/s);
assert.match(sql, /health_status='error'.*retry_exhausted/s);
assert.match(sql, /last_success_at=v_now/);
assert.match(sql, /last_offer_count=v_count/);
assert.match(sql, /last_published_count=v_count/);

const formatSql = fs.readFileSync('supabase/migrations/20260827153000_sportisimo_sale_card_format_v2.sql', 'utf8');
assert.match(formatSql, /current_cards0 as/);
assert.match(formatSql, /string_to_table\(product_text, chr\(10\)\)/);
assert.match(formatSql, /line ~ '\^Výprodej -\[0-9\]\+%\$'/);
assert.match(formatSql, /stock_line='Skladem'/);
assert.match(formatSql, /legacy_cards0 as/);
assert.match(formatSql, /DMOC:/);
assert.match(formatSql, /where not exists \(select 1 from current_cards0\)/);
assert.match(formatSql, /price>0 and old_price>price and discount_percent between 5 and 90/);
assert.match(formatSql, /u\.url like 'https:\/\/www\.sportisimo\.cz\/%'/);

const dualFormatSql = fs.readFileSync('supabase/migrations/20260827154500_sportisimo_sale_card_format_v3.sql', 'utf8');
assert.match(dualFormatSql, /compact_cards0 as/);
assert.match(dualFormatSql, /line ~ '\^\[0-9\]\[0-9 \]\* Kč \\(\-\[0-9\]\+\[\[:space:\]\]\*%\\\)\$'/);
assert.match(dualFormatSql, /when next1 like 'DMOC:%' then null::numeric/);
assert.match(dualFormatSql, /next1 ~ '\^\(DMOC: \)\?\[0-9\]\[0-9 \]\* Kč\$'/);
assert.match(dualFormatSql, /old_price is null or old_price>price/);
assert.match(dualFormatSql, /select \* from compact_cards0[\s\S]*where not exists \(select 1 from current_cards0\)/);
assert.match(dualFormatSql, /select \* from legacy_cards0[\s\S]*not exists \(select 1 from compact_cards0\)/);
assert.doesNotMatch(dualFormatSql, /when next1 like 'DMOC:%' then replace\(/, 'DMOC must never be treated as old_price');

console.log('Sportisimo transient retry and dual card rendering guard OK');
