import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260817190000_stavmat_expired_campaign_waiting_source.sql','utf8');

for (const required of [
  "v_page_to < v_today",
  "health_status='waiting_source'",
  "'reason','expired_campaign'",
  "last_parser_error=null",
  "if v_count<30 or v_count>150"
]) {
  if (!sql.includes(required)) throw new Error(`STAVMAT expiry guard missing: ${required}`);
}

console.log('stavmat expired campaign regression OK');
