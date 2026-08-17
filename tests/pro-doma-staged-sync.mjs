import fs from 'node:fs';
const src=fs.readFileSync('supabase/migrations/20260817173500_pro_doma_staged_verified_sync.sql','utf8');
for(const marker of [
  'parse_pro_doma_event_markdown',
  'trigger_pro_doma_verified_sync',
  'reconcile_pro_doma_index_sync',
  'reconcile_pro_doma_detail_sync',
  "like '%jako dárek%'",
  "like '%získáte jako dárek%'",
  "[[:space:]]*-[[:space:]]*",
  "status='completed'",
  "resp.content",
  "v_http record",
  "publish_structured_store_offers('pro-doma'",
  "revoke all on function public.trigger_pro_doma_verified_sync() from public,anon,authenticated",
  "grant execute on function public.trigger_pro_doma_verified_sync() to service_role",
  "sync-pro-doma-verified",
  "reconcile-pro-doma-index",
  "reconcile-pro-doma-details"
]) if(!src.includes(marker)) throw new Error(`PRO-DOMA staged guard missing: ${marker}`);
if(src.includes("status='ready'")) throw new Error('Unsupported queue status ready returned');
if(/join net\._http_response r\s+on r\.id/.test(src)) throw new Error('Ambiguous PL/pgSQL alias r returned');
console.log('PRO-DOMA staged sync regression OK');
