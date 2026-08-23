import assert from 'node:assert/strict';
import fs from 'node:fs';

const safe = fs.readFileSync('supabase/migrations/20260823063003_make_flop_product_sync_discovery_clock_safe.sql', 'utf8');
const regexFix = fs.readFileSync('supabase/migrations/20260823063104_fix_flop_week_filename_regex.sql', 'utf8');

assert(safe.includes('create or replace function public.trigger_flop_top_verified_sync()'), 'Flop trigger migration is missing');
assert(safe.includes('create or replace function public.reconcile_flop_top_verified_sync()'), 'Flop reconcile migration is missing');
assert(!safe.includes('update public.leaflet_sources'), 'Flop product/reconcile pipeline must not move leaflet discovery timestamps');
assert(!safe.includes('last_checked_at = v_now'), 'Flop product/reconcile pipeline must not own discovery last_checked_at');

assert(regexFix.includes("'(?:tisk_nahled_s|online)[.]pdf$'"), 'Flop week filename regex must avoid fragile backslash escaping');
assert(regexFix.includes("'IYYYIW'"), 'Flop week validity must use ISO week parsing');
assert(regexFix.includes(') + 2)::date'), 'Flop TOP validity must start on Wednesday of the ISO week');
assert(regexFix.includes(') + 8)::date'), 'Flop TOP validity must end on Tuesday of the following week');
assert(regexFix.includes("li.source_document_url !~* '/Flop_A_'"), 'Flop TOP must not consume the Flop_A leaflet variant');
assert(regexFix.includes("li.status in ('queued','downloading','processing','review','published','ignored')"), 'Flop trigger must accept discovered review PDFs even before AI validity extraction');
assert(!regexFix.includes('last_checked_at'), 'Flop trigger must never advance the discovery clock');

console.log('Flop discovery clock and ISO-week fallback contract OK');
