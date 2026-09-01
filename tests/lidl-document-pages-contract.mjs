import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260901214000_leaflet_document_pages.sql', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../supabase/functions/sync-lidl-document-pages/index.ts', import.meta.url), 'utf8');

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

console.log('Lidl official document page contract: OK');
