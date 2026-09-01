import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260901214000_leaflet_document_pages.sql', import.meta.url), 'utf8');
const sourcePagesMigration = readFileSync(new URL('../supabase/migrations/20260901215500_lidl_verified_source_pages.sql', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../supabase/functions/sync-lidl-document-pages/index.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../supabase/functions/sync-lidl-document-pages/config.toml', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.leaflet_document_pages/i, 'Canonical document page table is missing.');
assert.match(migration, /unique \(source_document_url, page_number, source_kind\)/i, 'Page identity must be unique per document/source kind.');
assert.match(migration, /page_number integer not null check \(page_number between 1 and 200\)/i, 'Page range guard is missing.');
assert.match(migration, /enable row level security/i, 'Document pages must have RLS enabled.');
assert.match(migration, /revoke all on table public\.leaflet_document_pages from public, anon, authenticated/i, 'Document page table must not be publicly readable.');
assert.match(migration, /create or replace function public\.replace_leaflet_document_pages_internal/i, 'Atomic page replacement RPC is missing.');
assert.match(migration, /security definer/i, 'Atomic page replacement must be security definer.');
assert.match(migration, /revoke all on function public\.replace_leaflet_document_pages_internal\(uuid,text,text,jsonb\) from public, anon, authenticated/i, 'Atomic page replacement RPC must be internal only.');
assert.match(migration, /page numbers must be unique and contiguous 1\.\.N/i, 'Atomic writer must reject incomplete page sequences.');
assert.match(migration, /sync-lidl-document-pages/i, 'Hourly Lidl document page schedule is missing.');
assert.match(migration, /'9 \* \* \* \*'/, 'Lidl page sync must stay staggered at minute 9.');
assert.doesNotMatch(migration, /leaflet_ocr_pages/i, 'Official document pages must never contaminate OCR completion rows.');

assert.match(worker, /endpoints\.leaflets\.schwarz\/v4\/overview/, 'Worker must use official Lidl overview API.');
assert.match(worker, /flyerJson/, 'Worker must consume official flyerJson page metadata.');
assert.match(worker, /lidl-official-flyer-json-v1/, 'Official page provenance is missing.');
assert.match(worker, /assets\.leaflets\.schwarz/, 'Worker must validate official PDF host.');
assert.match(worker, /imgproxy\.leaflets\.schwarz/, 'Worker must validate official page image host.');
assert.match(worker, /pages\.length < 1 \|\| pages\.length > 200/, 'Worker must reject implausible page counts.');
assert.match(worker, /new Set\(numbers\)\.size !== normalized\.length/, 'Worker must reject duplicate page numbers.');
assert.match(worker, /replace_leaflet_document_pages_internal/, 'Worker must use atomic page replacement RPC.');
assert.match(worker, /page_identity_available: true/, 'Worker must only mark page identity available after validated page sync.');
assert.match(worker, /page_identity_source: SOURCE_KIND/, 'Worker must persist page identity provenance.');
assert.doesNotMatch(worker, /\.from\(['"]leaflet_ocr_pages['"]\)/, 'Worker must not write OCR page rows.');
assert.doesNotMatch(worker, /\.from\(['"]offers['"]\)/, 'Page sync must not mutate offers.');
assert.doesNotMatch(worker, /\.from\(['"]products['"]\)/, 'Page sync must not mutate products.');
assert.doesNotMatch(worker, /detected_valid_from|detected_valid_to/, 'Page sync must not rewrite offer/import validity.');

assert.match(config, /^verify_jwt\s*=\s*false\s*$/m, 'Custom-auth Lidl page worker must declare verify_jwt=false for automated deployment.');
assert.match(worker, /token === SERVICE_ROLE_KEY/, 'verify_jwt=false is only safe while the worker validates service-role bearer auth itself.');
assert.match(worker, /x-cron-secret/, 'verify_jwt=false is only safe while the worker validates the cron secret itself.');
assert.match(worker, /\['admin', 'editor'\]/, 'verify_jwt=false is only safe while authenticated admin/editor access is checked in the worker.');

assert.match(sourcePagesMigration, /create or replace function private\.backfill_lidl_verified_source_pages\(p_import_id uuid\)/i, 'Verified Lidl source page backfill is missing.');
assert.match(sourcePagesMigration, /metadata->>'adapter'='lidl-verified-pdf-text-v1'/i, 'Backfill must only target the verified Lidl adapter.');
assert.match(sourcePagesMigration, /source_kind='lidl-official-flyer-json-v1'/i, 'Backfill must only use official Lidl document pages.');
assert.match(sourcePagesMigration, /and i\.source_page is null/i, 'Backfill must never overwrite an existing source_page.');
assert.match(sourcePagesMigration, /total_tokens>=2/i, 'Source page matching must require at least two meaningful title tokens.');
assert.match(sourcePagesMigration, /coverage=1/i, 'Source page matching must require full meaningful-token coverage.');
assert.match(sourcePagesMigration, /second_coverage,0\)<=0\.75/i, 'Source page matching must reject close or repeated page matches.');
assert.match(sourcePagesMigration, /source_page_source','lidl-official-flyer-json-v1-keywords-v1'/i, 'Source page provenance must be persisted.');
assert.match(sourcePagesMigration, /after insert or update of status, metadata on public\.leaflet_imports/i, 'Backfill trigger must react both to publication and later page-identity sync.');
assert.match(sourcePagesMigration, /page_identity_synced_at/i, 'Backfill trigger must react when official page identity arrives after publication.');
assert.match(sourcePagesMigration, /revoke all on function public\.backfill_lidl_verified_source_pages_internal\(uuid\) from public, anon, authenticated/i, 'Backfill RPC must remain internal.');
assert.doesNotMatch(sourcePagesMigration, /update public\.offers|update public\.products/i, 'Source page backfill must not mutate public offers or products.');

console.log('Lidl official document page contract: OK');
