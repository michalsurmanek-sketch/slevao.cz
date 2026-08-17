import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/sync-planeo-products/index.ts','utf8');

for (const required of [
  "/Akce sice skončila/i.test(text)",
  "health_status: 'waiting_source'",
  "reason: 'official_sale_ended'",
  "last_parser_error: null",
  "const dates = parseDates(text)"
]) {
  if (!source.includes(required)) throw new Error(`PLANEO ended-sale guard missing: ${required}`);
}

const guardPos = source.indexOf('/Akce sice skončila/i.test(text)');
const parsePos = source.indexOf('const dates = parseDates(text)');
if (guardPos < 0 || parsePos < 0 || guardPos > parsePos) {
  throw new Error('PLANEO ended-sale guard must run before date parsing');
}

console.log('planeo ended sale regression OK');
