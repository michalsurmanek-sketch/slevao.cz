import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const js = readFileSync(new URL('assets/home-all-stores.js', root), 'utf8');
const sql = readFileSync(new URL('supabase/migrations/20260818084500_public_feed_source_states.sql', root), 'utf8');
new Script(js, { filename:'assets/home-all-stores.js' });

assert.match(sql, /health_status = 'blocked' then 'blocked'/i);
assert.match(sql, /health_status = 'not_applicable' then 'not_applicable'/i);
assert.match(sql, /product_source_state = 'blocked' then 'source-blocked'/i);
assert.match(sql, /product_source_state = 'not_applicable' then 'not-applicable'/i);
assert.match(sql, /with \(security_invoker = true\)/i);
assert.match(js, /feed_status === 'source-blocked'\) return 'Nabídky teď nejsou dostupné';/);
assert.match(js, /feed_status === 'not-applicable'\) return 'Bez online nabídky';/);
assert.doesNotMatch(js, /health_reason|last_error|last_parser_error/, 'Frontend nesmí číst interní důvody blokace.');

console.log('Public feed source states OK');
