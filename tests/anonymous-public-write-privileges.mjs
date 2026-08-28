import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const grantsMigration = readFileSync(new URL('supabase/migrations/20260828144001_minimize_anon_public_table_write_grants.sql', root), 'utf8');
const reportMigration = readFileSync(new URL('supabase/migrations/20260828152152_harden_public_offer_report_insert.sql', root), 'utf8');

assert.ok(
  grantsMigration.includes('revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;'),
  'Anonymní role nemá globálně stažené write privilege v public schématu.'
);
assert.ok(
  grantsMigration.includes('grant insert on table public.offer_reports to anon;'),
  'Veřejné hlášení chybné nabídky přišlo o jediný záměrný anonymní write grant.'
);
assert.ok(!/grant\s+(?:update|delete|truncate|references|trigger)/i.test(grantsMigration), 'Migration vrací anonymní roli nebezpečný write grant.');
assert.ok(!/revoke\s+select/i.test(grantsMigration), 'Migration nesmí měnit veřejný SELECT.');

assert.ok(reportMigration.includes("if v_role in ('anon', 'authenticated') then"), 'Offer-report guard se nepouští pro veřejné klientské role.');
assert.ok(reportMigration.includes("new.status := 'new';"), 'Klient může podstrčit stav veřejného reportu.');
assert.ok(reportMigration.includes('new.resolved_at := null;'), 'Klient může podstrčit resolved_at veřejného reportu.');
assert.ok(reportMigration.includes('new.created_at := clock_timestamp();'), 'Klient může podstrčit created_at veřejného reportu.');
assert.ok(reportMigration.includes('new.user_id := auth.uid();'), 'User identity veřejného reportu není odvozena ze session.');
assert.ok(reportMigration.includes("char_length(new.page_url) > 2048"), 'Page URL veřejného reportu nemá serverový délkový limit.');
assert.ok(reportMigration.includes("new.page_url !~* '^https?://'"), 'Page URL veřejného reportu nepovoluje jen HTTP(S).');
assert.ok(reportMigration.includes('new.product_id := v_product_id;'), 'Product identity veřejného reportu se neodvozuje z offer_id.');
assert.ok(reportMigration.includes('new.product_id := null;'), 'Report bez offer_id může podstrčit libovolný product_id.');
assert.ok(reportMigration.includes('security definer'), 'Trigger helper potřebuje bezpečně dohledat nabídku nezávisle na klientském RLS.');
assert.ok(reportMigration.includes('set search_path = public, pg_temp'), 'SECURITY DEFINER helper nemá pevný search_path.');
assert.ok(reportMigration.includes('revoke all on function public.normalize_public_offer_report_insert() from public, anon, authenticated;'), 'Trigger helper je přímo spustitelný veřejnými rolemi.');
assert.ok(reportMigration.includes('grant execute on function public.normalize_public_offer_report_insert() to postgres, service_role;'), 'Trigger helper není dostupný serverovým rolím.');
assert.ok(/before insert on public\.offer_reports/i.test(reportMigration), 'Offer-report normalizace není zapojená jako BEFORE INSERT trigger.');

console.log('Anonymous writes are minimized and public offer-report inserts are server-normalized');
