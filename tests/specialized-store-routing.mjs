import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260817230500_route_specialized_stores_away_from_legacy_processor.sql', import.meta.url), 'utf8');

assert.match(sql, /s\.slug\s+not\s+in\s*\(\s*'billa'\s*,\s*'albert'\s*,\s*'tesco'\s*\)/i, 'BILLA, Albert and Tesco must bypass legacy process-leaflet.');
assert.match(sql, /functions\/v1\/process-leaflet/, 'Other queued imports must keep using the legacy processor for now.');
assert.match(sql, /for update of li skip locked/i, 'Dispatcher must preserve safe row claiming.');

console.log('specialized-store-routing: ok');
