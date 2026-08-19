import fs from 'node:fs';

const firstPath = 'supabase/migrations/20260819214207_fix_flop_waiting_source_and_official_url.sql';
const secondPath = 'supabase/migrations/20260819214307_preserve_waiting_source_health.sql';
const resolverPath = 'supabase/functions/sync-official-leaflet-sources/index.ts';

for (const path of [firstPath, secondPath, resolverPath]) {
  if (!fs.existsSync(path)) throw new Error(`Missing FLOP waiting-source file: ${path}`);
}

const first = fs.readFileSync(firstPath, 'utf8');
const second = fs.readFileSync(secondPath, 'utf8');
const resolver = fs.readFileSync(resolverPath, 'utf8');

for (const needle of [
  "source_url = 'https://www.flop-potraviny.cz/akcni-letaky/'",
  "health_status = 'waiting_source'",
  "health_reason = 'FLOP TOP: čekám na aktuální oficiální PDF.'",
  'return null;',
]) {
  if (!first.includes(needle)) throw new Error(`Missing first FLOP migration guard: ${needle}`);
}

for (const needle of [
  "if new.health_status = 'waiting_source' then",
  'return new;',
  "health_status = 'waiting_source'",
  'last_error = null',
  "health_reason = 'FLOP TOP: čekám na aktuální oficiální PDF.'",
]) {
  if (!second.includes(needle)) throw new Error(`Missing FLOP health guard: ${needle}`);
}

if (/raise\s+exception\s+['"]FLOP TOP: aktuální oficiální PDF nebylo nalezeno/i.test(first + second)) {
  throw new Error('Missing current FLOP PDF must remain a waiting-source state, not a cron exception.');
}

const correctCatalog = "{ slug: 'flop', name: 'Flop – akční leták', urls: ['https://www.flop-potraviny.cz/akcni-letaky/'] },";
if (!resolver.includes(correctCatalog)) throw new Error('FLOP resolver catalog must use the current official leaflet page.');
for (const stale of [
  "https://www.flop.cz/akcni-letak'",
  "https://www.flop-potraviny.cz/akcni-letak'",
]) {
  if (resolver.includes(stale)) throw new Error(`Stale FLOP resolver URL returned: ${stale}`);
}

console.log('FLOP waiting-source pipeline OK');
