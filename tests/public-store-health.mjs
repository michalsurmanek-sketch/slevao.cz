import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260817183000_public_store_health.sql', import.meta.url), 'utf8');

assert.match(sql, /get_public_store_health\s*\(/, 'Missing public store health RPC.');
assert.match(sql, /availability_status/, 'Store health must expose an explicit availability status.');
assert.match(sql, /'live'/, 'Store health must distinguish live stores.');
assert.match(sql, /'upcoming'/, 'Store health must distinguish upcoming stores.');
assert.match(sql, /'waiting_source'/, 'Store health must distinguish stores waiting for a source.');
assert.match(sql, /'catalog_only'/, 'Store health must distinguish catalog-only stores.');
assert.match(sql, /o\.status='published'/, 'Store health must count published offers only.');
assert.match(sql, /o\.is_verified is true/, 'Store health must count verified offers only.');
assert.match(sql, /timezone\('Europe\/Prague',now\(\)\)/, 'Store health must use Prague date boundaries.');
assert.match(sql, /security invoker/i, 'Store health must remain SECURITY INVOKER.');
assert.match(sql, /grant execute .* to anon, authenticated, service_role/i, 'Store health grants are incomplete.');
assert.doesNotMatch(sql, /last_error/, 'Public store health must not expose internal source errors.');

console.log('public-store-health: ok');
