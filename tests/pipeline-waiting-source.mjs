import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/run-leaflet-pipeline-v2/index.ts','utf8');

for (const required of [
  "data?.health_status==='waiting_source'",
  "!String(data?.last_error||'').trim()",
  "!String(data?.last_parser_error||'').trim()",
  "async function markSourceWaiting",
  "waiting_stores?:string[]",
  "waitingStores.push(slug)",
  "waiting_stores:waitingStores"
]) {
  if (!source.includes(required)) throw new Error(`pipeline waiting-source guard missing: ${required}`);
}

const waitingBody = source.slice(source.indexOf('async function markSourceWaiting'), source.indexOf('async function markSourceFailure'));
if (waitingBody.includes('last_success_at') || waitingBody.includes('last_strategy_success_at')) {
  throw new Error('waiting-source state must not be recorded as a successful source refresh');
}

console.log('pipeline waiting source regression OK');
