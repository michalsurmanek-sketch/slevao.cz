import assert from 'node:assert/strict';
import fs from 'node:fs';

const safe = fs.readFileSync('supabase/migrations/20260823063003_make_flop_product_sync_discovery_clock_safe.sql', 'utf8');
const regexFix = fs.readFileSync('supabase/migrations/20260823063104_fix_flop_week_filename_regex.sql', 'utf8');
const internal = fs.readFileSync('supabase/migrations/20260823064529_switch_flop_top_to_internal_spatial_pipeline.sql', 'utf8');

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

assert(internal.includes("'process-leaflet-basic'"), 'Flop pipeline must use internal pdfjs extraction when token data are missing');
assert(internal.includes("'sync-flop-pdf-products'"), 'Flop pipeline must invoke the deterministic spatial parser');
assert(internal.includes("'flop-pdf-basic-v3'"), 'Flop pdfjs step must be tracked as a job');
assert(internal.includes("'flop-pdf-spatial-unit-price-v3'"), 'Flop spatial publish step must be tracked as a job');
assert(internal.includes("e.parser='pdf-text-v3'"), 'Flop pipeline must require persisted pdfjs token extraction');
assert(internal.includes('v_current_count>=25'), 'Flop trigger must reuse a healthy current publication instead of spawning duplicate work');
assert(internal.includes('v_offer_count<25'), 'Flop reconcile must fail closed when too few offers reach the public feed');
assert(!internal.includes('r.jina.ai'), 'Jina must not remain on the critical Flop product path');
assert(!internal.includes('update public.leaflet_sources'), 'Final Flop product pipeline must not own leaflet source timestamps or errors');
assert(!internal.includes('last_checked_at'), 'Final Flop product pipeline must never advance discovery last_checked_at');

console.log('Flop discovery clock and internal PDF pipeline contract OK');
