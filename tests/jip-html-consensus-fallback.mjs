import assert from 'node:assert/strict';
import fs from 'node:fs';

const edge = fs.readFileSync('supabase/functions/sync-jip-html-consensus-products/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260824131208_schedule_jip_html_consensus_fallback.sql', 'utf8');

assert(edge.includes("const PARSER = 'jip-html-consensus-v1';"), 'Fallback must keep a dedicated deterministic parser identity.');
assert(edge.includes("const SOURCE_ADAPTER = 'jip-flip-pdf-v1';"), 'Fallback must stay attached to the official JIP flip source adapter.');
assert(edge.includes("Number(x?.metadata?.page_count) === 12"), 'Fallback must explicitly detect the primary 12-page MO contract.');
assert(edge.includes("primary_available: true"), 'Fallback must stand down when the primary 12-page source is available.');
assert(edge.includes("Number(x?.metadata?.page_count) === 24"), 'Fallback must only consider the verified 24-page gap sources.');
assert(edge.includes('/\\/CC-UCC-/i'), 'Fallback must require the current CC-UCC official leaflet.');
assert(edge.includes('/\\/CC-UCD-/i'), 'Fallback must require the current CC-UCD official leaflet.');
assert(edge.includes('Promise.allSettled([callHtml(ucc.id), callHtml(ucd.id)])'), 'Both official 24-page inputs must be parsed independently.');
assert(edge.includes('for (let attempt = 0; attempt < 2; attempt++)'), 'Transient HTML parsing may retry at most twice.');
assert(edge.includes('raw.vat_verified !== true'), 'Consensus candidates must retain VAT verification.');
assert(edge.includes('raw.identity_verified !== true'), 'Consensus candidates must retain strong identity verification.');
assert(edge.includes("numberAt(c, 'vat_delta') > 0.01"), 'VAT arithmetic tolerance must remain fail-closed.');
assert(edge.includes("numberAt(c, 'title_quantity_distance') > 2.5"), 'Title/quantity geometry guard must remain intact.');
assert(edge.includes("numberAt(c, 'title_price_distance') > 5.5"), 'Title/price geometry guard must remain intact.');
assert(edge.includes("numberAt(c, 'quantity_price_distance') > 6"), 'Quantity/price geometry guard must remain intact.');
assert(edge.includes('/[x×]/i.test(q)'), 'Ambiguous multipacks must be rejected.');
assert(edge.includes('consensus_source_count: 2'), 'Every published fallback candidate must be confirmed by both leaflets.');
assert(edge.includes('Number(c.source_page) !== Number(peer.source_page)'), 'Cross-leaflet matches must agree on source page.');
assert(edge.includes('safe.length < 8 || safe.length > 25'), 'Consensus candidate count must remain bounded by a fail-closed guard.');
assert(edge.includes("confidence: 0.995"), 'Published fallback confidence must remain at the verified floor.');
assert(edge.includes("if (existing?.status === 'published')"), 'Reruns must reuse an already published consensus import.');
assert(edge.includes("health_status: 'waiting_source'"), 'Missing paired fallback sources must report waiting_source rather than stale.');
assert(edge.includes("adapter_version: 'v2'"), 'Operational state must identify the retry-hardened fallback version.');

assert(migration.includes("'sync-jip-html-consensus-products'"), 'Cron must target the JIP consensus fallback function.');
assert(migration.includes("'22,52 * * * *'"), 'Fallback cron must remain five minutes behind the primary :17/:47 cadence.');
assert(migration.includes("x-cron-secret"), 'Cron invocation must use the private cron secret.');
assert(migration.includes('timeout_milliseconds := 120000'), 'Cron must retain the bounded 120s HTTP timeout.');

console.log('JIP HTML consensus fallback contract OK');
