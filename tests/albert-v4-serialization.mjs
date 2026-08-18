import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260818190657_serialize_albert_v4_publisher.sql','utf8');

for (const needle of [
  "pg_get_functiondef('public.publish_albert_publitas_text_offers_v4(text,jsonb)'::regprocedure)",
  "pg_advisory_xact_lock(hashtextextended(''slevao:albert-publitas-v4'', 0))",
  "if v_def like '%slevao:albert-publitas-v4%'",
  "raise exception 'Albert v4 publisher body changed; advisory lock insertion point was not found.'"
]) {
  if (!sql.includes(needle)) throw new Error(`Missing Albert v4 serialization guard: ${needle}`);
}

if (/pg_try_advisory_xact_lock/i.test(sql)) {
  throw new Error('Albert v4 publisher must serialize, not silently skip, concurrent publishes.');
}

console.log('Albert v4 serialization guard OK');
