import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('supabase/migrations/20260818080000_sync_public_feed_and_autopilot_rpcs.sql', root), 'utf8');

assert.match(sql, /create or replace function public\.get_public_current_leaflets\(/i, 'Chybí agregovaný veřejný feed letáků.');
assert.match(sql, /create or replace function public\.get_public_shopping_list_candidates\(/i, 'Chybí resolver vlastních položek Autopilotu.');
assert.match(sql, /create or replace function public\.get_shared_shopping_list_revision\(/i, 'Chybí revision RPC sdíleného seznamu.');
assert.match(sql, /'revision',\s*v_revision/i, 'Plný sdílený seznam nevrací revizi.');
assert.match(sql, /revoke all on function public\.get_public_shopping_list_candidates\(text\[\], integer\) from public;/i, 'Resolver znovu dědí obecný PUBLIC EXECUTE.');
assert.match(sql, /grant execute on function public\.get_public_shopping_list_candidates\(text\[\], integer\) to anon, authenticated, service_role;/i, 'Resolver nemá explicitní klientské role.');
assert.match(sql, /alter view public\.public_store_feed_health set \(security_invoker = true\);/i, 'Feed-health view není security invoker.');

console.log('DB migration sync 2026-08-18 OK');
