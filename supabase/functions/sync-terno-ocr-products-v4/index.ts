import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const PARSER_URL = `${SUPABASE_URL}/functions/v1/sync-terno-ocr-products-v5`;
const PARSER_VERSION = 'terno-ocr-spatial-unit-price-v5';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers:CORS });

function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}
function pragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type,p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

async function callParser(body: Record<string, unknown>) {
  const response = await fetch(PARSER_URL, {
    method:'POST',
    headers:{ authorization:`Bearer ${SERVICE_ROLE_KEY}`, apikey:SERVICE_ROLE_KEY, 'content-type':'application/json' },
    body:JSON.stringify(body),
  });
  const text = await response.text();
  let payload:any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw:text }; }
  if (!response.ok || payload?.ok === false) throw new Error(`Terno v5 HTTP ${response.status}: ${text.slice(0,700)}`);
  return payload;
}

async function updateHealth(storeId:string, candidateCount:number|null, importId:string|null) {
  const today = pragueToday();
  const { count, error:countError } = await db.from('offers')
    .select('id', { count:'exact', head:true })
    .eq('store_id',storeId)
    .eq('status','published')
    .lte('valid_from',today)
    .gte('valid_to',today);
  if (countError) throw countError;
  const published = count || 0;

  const { data:validity, error:validityError } = await db.from('offers')
    .select('valid_from,valid_to')
    .eq('store_id',storeId)
    .eq('status','published')
    .lte('valid_from',today)
    .gte('valid_to',today)
    .order('valid_from',{ascending:true})
    .limit(100);
  if (validityError) throw validityError;
  const validFrom = (validity || []).map((x:any)=>x.valid_from).filter(Boolean).sort()[0] || null;
  const validTo = (validity || []).map((x:any)=>x.valid_to).filter(Boolean).sort().at(-1) || null;
  const expected = candidateCount && candidateCount > 0 ? candidateCount : Math.max(1,published);
  const complete = published > 0 && published >= expected;
  const now = new Date().toISOString();

  const { error } = await db.from('store_product_sync_state').upsert({
    store_id:storeId,
    last_run_at:now,
    last_success_at:now,
    last_offer_count:published,
    expected_offer_count:expected,
    last_published_count:published,
    last_valid_from:validFrom,
    last_valid_to:validTo,
    parser_version:PARSER_VERSION,
    adapter_name:'sync-terno-ocr-products-v4',
    adapter_version:'v4-wrapper-v5-parser',
    source_type:'official-ocr',
    source_category:'current-leaflet',
    coverage_scope:'city',
    last_error:null,
    last_parser_error:null,
    last_product_candidates:expected,
    health_status:complete ? 'ok' : 'degraded',
    health_reason:complete
      ? `Terno: bezpečně publikováno všech ${published}/${expected} matematicky ověřených OCR nabídek.`
      : `Terno: bezpečně publikováno ${published}/${expected} matematicky ověřených OCR nabídek; část bezpečných kandidátů se nepodařilo zveřejnit.`,
    is_running:false,
    run_started_at:null,
    updated_at:now,
    last_import_id:importId,
    metadata:{ conservative_parser:true, split_price_support:true, candidate_publication_complete:complete, wrapper_version:'v4.2' },
  }, { onConflict:'store_id' });
  if (error) throw error;
  return { published, expected, valid_from:validFrom, valid_to:validTo };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers:CORS });
  if (req.method !== 'POST') return json({ error:'Method not allowed' },405);
  if (!allowed(req)) return json({ error:'Unauthorized' },401);
  try {
    const body = await req.json().catch(()=>({}));
    const dryRun = body.dry_run === true;
    const parser = await callParser({ ...body, dry_run:dryRun });
    if (dryRun) return json({ ok:true, dry_run:true, parser });

    const { data:store, error:storeError } = await db.from('stores').select('id').eq('slug','terno').maybeSingle();
    if (storeError) throw storeError;
    if (!store) throw new Error('Terno store not found.');
    const candidateCount = Number(parser?.candidate_count || 0) || null;
    const importId = String(parser?.import_id || '') || null;
    const health = await updateHealth(store.id,candidateCount,importId);
    return json({ ok:true, parser, health });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok:false, error:message },500);
  }
});
