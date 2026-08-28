import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(
  new URL('supabase/migrations/20260828171428_repair_and_batch_expired_offer_cleanup.sql', root),
  'utf8',
);
const sql = migration.toLowerCase();

assert.ok(
  sql.includes('create index if not exists offers_expiry_cleanup_idx') &&
  sql.includes('on public.offers(valid_to, id)'),
  'Cleanup musí mít cílený index podle valid_to,id.',
);
assert.ok(
  sql.includes("timezone('europe/prague', now())"),
  'Cleanup musí používat pražské datum stejně jako veřejná nabídka.',
);
assert.ok(
  sql.includes('v_batch_limit constant integer := 250'),
  'Cleanup musí zůstat dávkovaný po 250 nabídkách.',
);
assert.ok(
  sql.includes('for update skip locked'),
  'Cleanup musí používat SKIP LOCKED pro bezpečný souběh.',
);
assert.ok(
  sql.includes("pg_try_advisory_xact_lock(hashtextextended('slevao:archive_expired_offers', 0))"),
  'Cleanup musí mít transakční advisory lock proti překryvu běhů.',
);
assert.ok(
  sql.includes("jsonb_build_object('archived_offer_id', ph.offer_id::text)"),
  'Price history musí zachovat původní offer id před FK SET NULL.',
);
assert.ok(
  sql.includes("jsonb_build_object('provenance', 'expired_offer_archive')"),
  'Price history bez source/provenance musí před smazáním dostat archivní provenance.',
);
const historyUpdate = sql.indexOf('update public.price_history ph');
const offerDelete = sql.indexOf('delete from public.offers o');
assert.ok(historyUpdate >= 0 && offerDelete > historyUpdate,
  'Price-history provenance se musí připravit před DELETE offers.');
assert.ok(
  sql.includes('revoke all on function public.archive_and_delete_expired_offers() from public, anon, authenticated'),
  'Cleanup RPC nesmí být veřejně spustitelné.',
);
assert.ok(
  sql.includes('grant execute on function public.archive_and_delete_expired_offers() to postgres, service_role'),
  'Cleanup musí zůstat dostupný serverovým rolím a cronu.',
);

console.log('Expired offer cleanup batching/provenance contract OK');
await import('./price-history-provenance-validation.mjs');
