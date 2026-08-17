import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../supabase/functions/generate-leaflet-product-crops/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260817223000_pause_unsafe_leaflet_crop_cron.sql', import.meta.url), 'utf8');

assert.match(source, /paused:\s*true/, 'Leaflet crop worker must remain paused until pending candidates are approval-gated.');
assert.match(source, /leaflet_crop_pending_requires_approval/, 'Paused worker must explain the approval-gate reason.');
assert.doesNotMatch(source, /from\(['"]offers['"]\)\.update\(\{\s*image_url/, 'Pending crop worker must never write directly to live offer image_url.');
assert.match(migration, /cron\.unschedule\(['"]leaflet-crop-backfill['"]\)/, 'Automatic crop backfill must remain unscheduled while the worker is paused.');

console.log('leaflet-crop-approval-gate: ok');
