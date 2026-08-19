import fs from 'node:fs';

const path = 'supabase/migrations/20260819141912_index_web_push_deliveries_subscription.sql';
if (!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql = fs.readFileSync(path, 'utf8');

for (const needle of [
  'create index if not exists web_push_deliveries_subscription_idx',
  'on public.web_push_deliveries(subscription_id, status, created_at desc)'
]) {
  if (!sql.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(`Missing Web Push delivery index guard: ${needle}`);
  }
}

if (/drop\s+index/i.test(sql)) throw new Error('Web Push delivery index migration must not drop indexes.');
if (/delete\s+from|update\s+public\.web_push_deliveries/i.test(sql)) throw new Error('Index migration must not mutate delivery data.');

console.log('Web Push delivery subscription FK index OK');
