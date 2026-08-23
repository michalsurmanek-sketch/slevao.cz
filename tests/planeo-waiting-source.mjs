import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/sync-planeo-products/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260823110259_make_planeo_dedicated_waiting_source.sql', 'utf8');

assert(source.includes("const ADAPTER = 'planeo-official-clearance-v1';"), 'PLANEO canonical product adapter must stay explicit.');
assert(source.includes("normalized.includes('zadne produkty k zobrazeni')"), 'PLANEO must recognize an explicitly empty official catalogue.');
assert(source.includes("normalized.includes('az se to spusti budte pripraveni')"), 'PLANEO must recognize the official future-campaign placeholder.');
assert(source.includes("waiting_source: true, reason: 'no_current_campaign'"), 'Empty PLANEO campaign must be waiting_source, not an error.');
assert(source.includes("reason: 'future_campaign'"), 'Future PLANEO campaign must wait until its official start.');
assert(source.includes("reason: 'expired_campaign'"), 'Expired PLANEO campaign must wait for replacement.');
assert(source.includes("if (unique.length !== 25)"), 'Active PLANEO product parsing must retain its fail-closed 25-product contract.');
assert(source.includes("health_status: 'waiting_source'"), 'PLANEO sync must write waiting_source state itself.');
assert(source.includes("health_status: 'error'"), 'Real PLANEO parsing/HTTP failures must remain errors.');

assert(migration.includes("automation_mode='dedicated'"), 'PLANEO must stay outside generic leaflet discovery.');
assert(migration.includes("adapter_key='planeo-official-clearance-v1'"), 'PLANEO dedicated owner must remain canonical.');
assert(migration.includes("archive_reason','superseded_by_planeo_dedicated_pipeline'"), 'Generic PLANEO review work must be archived when dedicated ownership takes over.');

console.log('PLANEO waiting-source ownership contract OK');
