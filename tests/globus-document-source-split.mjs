import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260825173500_split_globus_document_source.sql', 'utf8');
const discovery = readFileSync('supabase/functions/discover-leaflets/index.ts', 'utf8');

assert.match(migration, /https:\/\/www\.globus\.cz\/olomouc\/letaky\/aktualni/,
  'Globus must have a dedicated current-leaflet source.');
assert.match(migration, /globus-leaflet-document-v1/,
  'Dedicated Globus leaflet source must be distinguishable from product API sync.');
assert.match(migration, /extraction_strategy[\s\S]*html_document/i,
  'Globus leaflet source must use document-oriented extraction metadata.');
assert.match(migration, /last_checked_at = null/i,
  'Migration must force the new/split source to be due for discovery immediately.');
assert.doesNotMatch(migration, /globus-action-products-api-v1/,
  'Document source migration must not reuse the Globus product adapter.');
assert.match(discovery, /const listingUrl = 'https:\/\/www\.globus\.cz\/olomouc\/letaky\/aktualni';/,
  'Discovery runtime must still resolve Globus through the dedicated leaflet page.');
assert.match(discovery, /adapter = 'store:globus-html'/,
  'Globus document discovery must mark generated imports with its document adapter.');
assert.match(discovery, /source\.last_checked_at[\s\S]*check_interval_minutes/,
  'Discovery due-time remains source-row scoped, which is why product/document sources must stay split.');

console.log('Globus product and document discovery clocks are separated.');
