import fs from 'node:fs';

const path = 'supabase/migrations/20260818202312_restrict_offer_source_identity_trigger_execute.sql';
if (!fs.existsSync(path)) throw new Error(`Missing migration: ${path}`);
const sql = fs.readFileSync(path, 'utf8');

for (const needle of [
  "p.proname='set_offer_source_identity'",
  "p.prorettype='trigger'::regtype",
  'p.prosecdef=true',
  "c.relname='offers'",
  "t.tgname='trg_set_offer_source_identity'",
  'revoke execute on function public.set_offer_source_identity() from public;',
  'revoke execute on function public.set_offer_source_identity() from anon;',
  'revoke execute on function public.set_offer_source_identity() from authenticated;',
  'grant execute on function public.set_offer_source_identity() to service_role;'
]) {
  if (!sql.includes(needle)) throw new Error(`Missing offer-source trigger security guard: ${needle}`);
}

for (const forbidden of [
  /drop\s+trigger/i,
  /drop\s+function/i,
  /create\s+or\s+replace\s+function/i,
  /alter\s+function/i,
  /disable\s+trigger/i,
  /update\s+public\.offers/i,
  /delete\s+from\s+public\.offers/i
]) {
  if (forbidden.test(sql)) throw new Error(`Trigger privilege migration contains forbidden mutation: ${forbidden}`);
}

console.log('Offer source identity trigger execution privileges OK');
